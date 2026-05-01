import logging
import os
import shutil
import sys
from subprocess import PIPE, CalledProcessError, run as subprocess_run  # nosec
from tempfile import TemporaryFile

from rpdk.core.data_loaders import resource_stream
from rpdk.core.exceptions import DownstreamError
from rpdk.core.init import input_with_validation
from rpdk.core.jsonutils.resolver import ContainerType, resolve_models
from rpdk.core.plugin_base import LanguagePlugin

from .resolver import contains_model, get_inner_type, translate_type
from .utils import safe_reserved

if sys.version_info >= (3, 8):  # pragma: no cover
    from zipfile import ZipFile
else:  # pragma: no cover
    from zipfile38 import ZipFile


LOG = logging.getLogger(__name__)

EXECUTABLE = "cfn"
SUPPORT_LIB_NAME = (
    "@amazon-web-services-cloudformation/cloudformation-cli-typescript-lib"
)
SUPPORT_LIB_VERSION = "^1.0.6"
MAIN_HANDLER_FUNCTION = "TypeFunction"


def validate_no(value):
    return value.lower() not in ("n", "no")


class TypescriptLanguagePlugin(LanguagePlugin):
    MODULE_NAME = __name__
    NAME = "typescript"
    RUNTIME = "nodejs20.x"
    ENTRY_POINT = "dist/handlers.entrypoint"
    TEST_ENTRY_POINT = "dist/handlers.testEntrypoint"
    CODE_URI = "./"

    def __init__(self):
        self.env = self._setup_jinja_env(
            trim_blocks=True, lstrip_blocks=True, keep_trailing_newline=True
        )
        self.env.filters["translate_type"] = translate_type
        self.env.filters["contains_model"] = contains_model
        self.env.filters["get_inner_type"] = get_inner_type
        self.env.filters["safe_reserved"] = safe_reserved
        self.env.globals["ContainerType"] = ContainerType
        self.namespace = None
        self.package_name = None
        self.package_root = None
        self._use_docker = None
        self._no_docker = None
        self._protocol_version = "2.0.0"
        self._build_command = None
        self._lib_path = None

    def _init_from_project(self, project):
        self.namespace = tuple(s.lower() for s in project.type_info)
        self.package_name = "-".join(self.namespace)
        # Check config file for (legacy) 'useDocker' and use_docker settings
        self._use_docker = project.settings.get("useDocker") or project.settings.get(
            "use_docker"
        )
        self.package_root = project.root / "src"
        self._build_command = project.settings.get("buildCommand", None)
        self._lib_path = SUPPORT_LIB_VERSION

    def _init_settings(self, project):
        LOG.debug("Writing settings")
        # If use_docker specified in .rpdk-config file or cli switch
        # Ensure only 1 is true, with preference to use_docker
        if project.settings.get("use_docker") is True:
            self._use_docker = True
            self._no_docker = False
        # If no_docker specified in .rpdk-config file or cli switch
        elif project.settings.get("no_docker") is True:
            self._use_docker = False
            self._no_docker = True
        else:
            # If neither no_docker nor use_docker specified in .rpdk-config
            # file or cli switch, prompt to use containers or not
            self._use_docker = input_with_validation(
                "Use docker for platform-independent packaging (Y/n)?\n",
                validate_no,
                "This is highly recommended unless you are experienced \n"
                "with cross-platform Typescript packaging.",
            )
            self._no_docker = not self._use_docker

        # switched to 'use_docker' from 'useDocker' to be in line with python version
        # project.settings will get saved into .rpdk-config by cloudformation-cli
        project.settings["use_docker"] = self._use_docker
        project.settings["no_docker"] = self._no_docker
        project.settings["protocolVersion"] = self._protocol_version

    def init(self, project):
        LOG.debug("Init started")

        self._init_from_project(project)
        self._init_settings(project)

        project.runtime = self.RUNTIME
        project.entrypoint = self.ENTRY_POINT
        project.test_entrypoint = self.TEST_ENTRY_POINT

        def _render_template(path, **kwargs):
            LOG.debug("Writing '%s'", path)
            template = self.env.get_template(path.name)
            contents = template.render(**kwargs)
            project.safewrite(path, contents)

        def _copy_resource(path, resource_name=None):
            LOG.debug("Writing '%s'", path)
            if not resource_name:
                resource_name = path.name
            contents = resource_stream(__name__, f"data/{resource_name}").read()
            project.safewrite(path, contents)

        # handler Typescript package
        handler_package_path = self.package_root
        LOG.debug("Making folder '%s'", handler_package_path)
        handler_package_path.mkdir(parents=True, exist_ok=True)
        _render_template(
            handler_package_path / "handlers.ts",
            lib_name=SUPPORT_LIB_NAME,
            type_name=project.type_name,
        )
        # models.ts produced by generate

        # project support files
        _copy_resource(project.root / ".gitignore", "typescript.gitignore")
        _copy_resource(project.root / ".npmrc")
        sam_tests_folder = project.root / "sam-tests"
        sam_tests_folder.mkdir(exist_ok=True)
        _copy_resource(sam_tests_folder / "create.json")
        _copy_resource(project.root / "tsconfig.json")
        _render_template(
            project.root / "package.json",
            name=project.hypenated_name,
            description=f"AWS custom resource provider named {project.type_name}.",
            lib_name=SUPPORT_LIB_NAME,
            lib_path=self._lib_path,
        )
        _render_template(
            project.root / "README.md",
            type_name=project.type_name,
            schema_path=project.schema_path,
            project_path=self.package_name,
            executable=EXECUTABLE,
            lib_name=SUPPORT_LIB_NAME,
        )

        _render_template(
            project.root / "Makefile",
        )

        # CloudFormation/SAM template for handler lambda
        handler_params = {
            "Handler": project.entrypoint,
            "Runtime": project.runtime,
            "CodeUri": self.CODE_URI,
        }
        test_handler_params = {
            **handler_params,
            "Handler": project.test_entrypoint,
        }
        _render_template(
            project.root / "template.yml",
            resource_type=project.type_name,
            handler_params=handler_params,
            test_handler_params=test_handler_params,
        )

        LOG.debug("Init complete")

    def generate(self, project):
        LOG.debug("Generate started")

        self._init_from_project(project)

        models = resolve_models(project.schema)

        if project.configuration_schema:
            configuration_models = resolve_models(
                project.configuration_schema, "TypeConfigurationModel"
            )
        else:
            configuration_models = {"TypeConfigurationModel": {}}

        models.update(configuration_models)

        path = self.package_root / "models.ts"
        LOG.debug("Writing file: %s", path)
        template = self.env.get_template("models.ts")

        contents = template.render(
            lib_name=SUPPORT_LIB_NAME,
            type_name=project.type_name,
            models=models,
            contains_type_configuration=project.configuration_schema,
            primaryIdentifier=project.schema.get("primaryIdentifier", []),
            additionalIdentifiers=project.schema.get("additionalIdentifiers", []),
        )
        project.overwrite(path, contents)

        LOG.debug("Generate complete")

    def _pre_package(self, build_path):
        # Caller should own/delete this, not us.
        # pylint: disable=consider-using-with
        f = TemporaryFile("w+b")

        # pylint: disable=unexpected-keyword-arg
        with ZipFile(f, mode="w", strict_timestamps=False) as zip_file:
            self._recursive_relative_write(build_path, build_path, zip_file)
        f.seek(0)

        return f

    @staticmethod
    def _recursive_relative_write(src_path, base_path, zip_file):
        for path in src_path.rglob("*"):
            if path.is_file():
                relative = path.relative_to(base_path)
                zip_file.write(path.resolve(), str(relative))

    def package(self, project, zip_file):
        LOG.debug("Package started")

        self._init_from_project(project)

        handler_package_path = self.package_root
        build_path = project.root / "build"

        self._remove_build_artifacts(build_path)
        self._build(project.root)

        inner_zip = self._pre_package(build_path / MAIN_HANDLER_FUNCTION)
        zip_file.writestr("ResourceProvider.zip", inner_zip.read())
        self._recursive_relative_write(handler_package_path, project.root, zip_file)

        LOG.debug("Package complete")

    @staticmethod
    def _remove_build_artifacts(deps_path):
        try:
            shutil.rmtree(deps_path)
        except FileNotFoundError:
            LOG.debug("'%s' not found, skipping removal", deps_path, exc_info=True)

    @staticmethod
    def _make_build_command(base_path, build_command=None):
        command = (
            "npm install --include=optional "
            + f"&& sam build --debug --build-dir {os.path.join(base_path, 'build')}"
        )
        if build_command is not None:
            command = build_command
        return command

    def _build(self, base_path):
        LOG.debug("Dependencies build started from '%s'", base_path)

        # TODO: We should use the build logic from SAM CLI library, instead:
        # https://github.com/awslabs/aws-sam-cli/blob/master/samcli/lib/build/app_builder.py
        command = self._make_build_command(base_path, self._build_command)
        if self._use_docker:
            command = command + " --use-container"
        command = command + " " + MAIN_HANDLER_FUNCTION

        LOG.debug("command is '%s'", command)

        LOG.warning("Starting build.")
        try:
            # On windows get the default CLI in environment variable comspec
            # run 1 command and exit. Building shell command manually, subprocess.run
            # with shell=True behavior is inconsistent on windows
            if sys.platform == "win32":  # pragma: no cover
                shell = os.environ.get("comspec")
                shell_arg = "/C"
                completed_proc = subprocess_run(  # nosec
                    [shell, shell_arg, command],
                    stdout=PIPE,
                    stderr=PIPE,
                    cwd=base_path,
                    check=True,
                    universal_newlines=True,
                )
            else:  # pragma: no cover
                # On all other OS use default shell in subprocess to run build command
                completed_proc = subprocess_run(  # nosec
                    [command],
                    stdout=PIPE,
                    stderr=PIPE,
                    cwd=base_path,
                    check=True,
                    shell=True,
                    universal_newlines=True,
                )

        except (FileNotFoundError, CalledProcessError) as e:
            LOG.warning(e.stderr)
            raise DownstreamError("local build failed") from e

        LOG.debug("--- build stdout:\n%s", completed_proc.stdout)
        LOG.debug("--- build stderr:\n%s", completed_proc.stderr)
        LOG.debug("Dependencies build finished")
