# pylint: disable=redefined-outer-name,protected-access
import os
import sys
from subprocess import CalledProcessError
from unittest.mock import patch, sentinel
from uuid import uuid4

import pytest
from rpdk.core.exceptions import DownstreamError
from rpdk.core.project import Project
from rpdk.typescript.codegen import (
    SUPPORT_LIB_NAME,
    TypescriptLanguagePlugin,
    validate_no,
)

if sys.version_info >= (3, 8):  # pragma: no cover
    from zipfile import ZipFile
else:  # pragma: no cover
    from zipfile38 import ZipFile


TYPE_NAME = "foo::bar::baz"


@pytest.fixture
def plugin():
    return TypescriptLanguagePlugin()


@pytest.fixture
def project(tmp_path: str):
    project = Project(root=tmp_path)

    patch_plugins = patch.dict(
        "rpdk.core.plugin_registry.PLUGIN_REGISTRY",
        {TypescriptLanguagePlugin.NAME: lambda: TypescriptLanguagePlugin},
        clear=True,
    )
    patch_wizard = patch(
        "rpdk.typescript.codegen.input_with_validation",
        autospec=True,
        side_effect=[False],
    )
    with patch_plugins, patch_wizard:
        current_path = os.path.abspath(__file__)
        lib_abspath = os.path.abspath(os.path.join(current_path, "..", "..", ".."))
        TypescriptLanguagePlugin.SUPPORT_LIB_URI = f"file:{lib_abspath}"
        project.init(TYPE_NAME, TypescriptLanguagePlugin.NAME)
    return project


def get_files_in_project(project: Project):
    return {
        str(child.relative_to(project.root)): child for child in project.root.rglob("*")
    }


@pytest.mark.parametrize(
    "value,result",
    [
        ("y", True),
        ("Y", True),
        ("yes", True),
        ("Yes", True),
        ("YES", True),
        ("asdf", True),
        ("no", False),
        ("No", False),
        ("No", False),
        ("n", False),
        ("N", False),
    ],
)
def test_validate_no(value: str, result: bool):
    assert validate_no(value) is result


def test__remove_build_artifacts_file_found(tmp_path: str):
    deps_path = tmp_path / "build"
    deps_path.mkdir()
    TypescriptLanguagePlugin._remove_build_artifacts(deps_path)


def test__remove_build_artifacts_file_not_found(tmp_path: str):
    deps_path = tmp_path / "build"
    with patch("rpdk.typescript.codegen.LOG", autospec=True) as mock_log:
        TypescriptLanguagePlugin._remove_build_artifacts(deps_path)

    mock_log.debug.assert_called_once()


def test_initialize(project: Project):
    lib_path = project._plugin._lib_path
    assert project.settings == {"useDocker": False, "protocolVersion": "2.0.0"}

    files = get_files_in_project(project)
    assert set(files) == {
        ".gitignore",
        ".npmrc",
        ".rpdk-config",
        "foo-bar-baz.json",
        "example_inputs",
        "example_inputs/inputs_1_create.json",
        "example_inputs/inputs_1_invalid.json",
        "example_inputs/inputs_1_update.json",
        "package.json",
        "README.md",
        "sam-tests",
        "sam-tests/create.json",
        "src",
        "src/handlers.ts",
        "template.yml",
        "tsconfig.json",
    }

    assert "node_modules" in files[".gitignore"].read_text()
    package_json = files["package.json"].read_text()
    assert SUPPORT_LIB_NAME in package_json
    assert lib_path in package_json

    readme = files["README.md"].read_text()
    assert project.type_name in readme
    assert SUPPORT_LIB_NAME in readme
    assert "handlers.ts" in readme
    assert "models.ts" in readme

    assert project.entrypoint in files["template.yml"].read_text()


def test_generate(project: Project):
    project.load_schema()
    before = get_files_in_project(project)
    project.generate()
    after = get_files_in_project(project)
    files = after.keys() - before.keys() - {"resource-role.yaml"}

    assert files == {"src/models.ts"}


def test_package_local(project: Project):
    project.load_schema()
    project.generate()

    zip_path = project.root / "foo-bar-baz.zip"

    # pylint: disable=unexpected-keyword-arg
    with zip_path.open("wb") as f, ZipFile(
        f, mode="w", strict_timestamps=False
    ) as zip_file:
        project._plugin.package(project, zip_file)

    with zip_path.open("rb") as f, ZipFile(
        f, mode="r", strict_timestamps=False
    ) as zip_file:
        assert sorted(zip_file.namelist()) == [
            "ResourceProvider.zip",
            "src/handlers.ts",
            "src/models.ts",
        ]


def test__build_called_process_error(plugin: TypescriptLanguagePlugin, tmp_path: str):
    executable_name = str(uuid4())
    plugin._build_command = executable_name

    with patch.object(
        TypescriptLanguagePlugin,
        "_make_build_command",
        wraps=TypescriptLanguagePlugin._make_build_command,
    ) as mock_cmd:
        with pytest.raises(DownstreamError) as excinfo:
            plugin._build(tmp_path)

    mock_cmd.assert_called_once_with(tmp_path, executable_name)

    assert isinstance(excinfo.value.__cause__, CalledProcessError)


def test__build_docker(plugin: TypescriptLanguagePlugin):
    plugin._use_docker = True

    patch_cmd = patch.object(
        TypescriptLanguagePlugin, "_make_build_command", return_value=""
    )
    patch_subprocess_run = patch(
        "rpdk.typescript.codegen.subprocess_run", autospec=True
    )
    with patch_cmd as mock_cmd, patch_subprocess_run as mock_subprocess_run:
        plugin._build(sentinel.base_path)

    mock_cmd.assert_called_once_with(sentinel.base_path, None)
    mock_subprocess_run.assert_called_once_with(
        ["/bin/bash", "-c", " --use-container TypeFunction"],
        check=True,
        cwd=sentinel.base_path,
        stderr=-1,
        stdout=-1,
    )
