# fixture and parameter have the same name
# pylint: disable=redefined-outer-name
import pytest
from rpdk.core.exceptions import WizardValidationError
from rpdk.typescript.utils import (
    safe_reserved,
    validate_codegen_model as validate_codegen_model_factory,
)

DEFAULT = object()


@pytest.fixture
def validate_codegen_model():
    return validate_codegen_model_factory(DEFAULT)


def test_safe_reserved_safe_string():
    assert safe_reserved("foo") == "foo"


def test_safe_reserved_unsafe_javascript_string():
    assert safe_reserved("null") == "null_"


def test_safe_reserved_unsafe_typescript_string():
    assert safe_reserved("interface") == "interface_"


def test_validate_codegen_model_choose_1(validate_codegen_model):
    assert validate_codegen_model("1") == "1"


def test_validate_codegen_model_choose_2(validate_codegen_model):
    assert validate_codegen_model("2") == "2"


def test_validate_codegen_model_invalid_selection(validate_codegen_model):
    with pytest.raises(WizardValidationError) as excinfo:
        validate_codegen_model("3")
    assert "Invalid selection." in str(excinfo.value)


def test_validate_codegen_model_no_selection(validate_codegen_model):
    assert validate_codegen_model("") == DEFAULT
