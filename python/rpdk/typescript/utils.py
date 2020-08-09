import re

from rpdk.core.exceptions import WizardValidationError

# https://github.com/Microsoft/TypeScript/issues/2536
LANGUAGE_KEYWORDS = {
    "abstract",
    "any",
    "as",
    "async",
    "await",
    "bigint",
    "boolean",
    "break",
    "case",
    "catch",
    "class",
    "configurable",
    "const",
    "constructor",
    "continue",
    "debugger",
    "declare",
    "default",
    "delete",
    "do",
    "else",
    "enum",
    "enumerable",
    "export",
    "extends",
    "false",
    "finally",
    "for",
    "from",
    "function",
    "get",
    "if",
    "in",
    "implements",
    "import",
    "instanceof",
    "interface",
    "is",
    "let",
    "module",
    "namespace",
    "never",
    "new",
    "null",
    "number",
    "of",
    "package",
    "private",
    "protected",
    "public",
    "readonly",
    "require",
    "return",
    "set",
    "static",
    "string",
    "super",
    "switch",
    "symbol",
    "this",
    "throw",
    "true",
    "try",
    "type",
    "typeof",
    "undefined",
    "value",
    "var",
    "void",
    "while",
    "with",
    "writable",
    "yield",
}


def safe_reserved(token):
    if token in LANGUAGE_KEYWORDS:
        return token + "_"
    return token


def validate_codegen_model(default):
    pattern = r"^[1-2]$"

    def _validate_codegen_model(value):
        if not value:
            return default

        match = re.match(pattern, value)
        if not match:
            raise WizardValidationError("Invalid selection.")

        return value

    return _validate_codegen_model
