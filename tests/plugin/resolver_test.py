import pytest
from rpdk.core.jsonutils.resolver import ContainerType, ResolvedType
from rpdk.typescript.resolver import (
    PRIMITIVE_TYPES,
    contains_model,
    get_inner_type,
    translate_type,
)

RESOLVED_TYPES = [
    (ResolvedType(ContainerType.PRIMITIVE, item_type), native_type)
    for item_type, native_type in PRIMITIVE_TYPES.items()
]


def test_translate_type_model_passthrough():
    item_type = object()
    translated = translate_type(ResolvedType(ContainerType.MODEL, item_type))
    assert translated is item_type


@pytest.mark.parametrize("resolved_type,native_type", RESOLVED_TYPES)
def test_translate_type_primitive(resolved_type, native_type):
    assert translate_type(resolved_type) == native_type


@pytest.mark.parametrize("resolved_type,native_type", RESOLVED_TYPES)
def test_translate_type_dict(resolved_type, native_type):
    translated = translate_type(ResolvedType(ContainerType.DICT, resolved_type))
    assert translated == f"Map<string, {native_type}>"


@pytest.mark.parametrize("resolved_type,native_type", RESOLVED_TYPES)
def test_translate_type_list(resolved_type, native_type):
    translated = translate_type(ResolvedType(ContainerType.LIST, resolved_type))
    assert translated == f"Array<{native_type}>"


@pytest.mark.parametrize("resolved_type,native_type", RESOLVED_TYPES)
def test_translate_type_set(resolved_type, native_type):
    translated = translate_type(ResolvedType(ContainerType.SET, resolved_type))
    assert translated == f"Set<{native_type}>"


@pytest.mark.parametrize("resolved_type,_native_type", RESOLVED_TYPES)
def test_translate_type_multiple(resolved_type, _native_type):
    translated = translate_type(ResolvedType(ContainerType.MULTIPLE, resolved_type))
    assert translated == "object"


@pytest.mark.parametrize("resolved_type,_native_type", RESOLVED_TYPES)
def test_translate_type_unknown(resolved_type, _native_type):
    with pytest.raises(ValueError):
        translate_type(ResolvedType("foo", resolved_type))


@pytest.mark.parametrize("resolved_type,_native_type", RESOLVED_TYPES)
def test_contains_model_list_containing_primitive(resolved_type, _native_type):
    assert contains_model(ResolvedType(ContainerType.LIST, resolved_type)) is False


def test_contains_model_list_containing_model():
    resolved_type = ResolvedType(
        ContainerType.LIST,
        ResolvedType(ContainerType.LIST, ResolvedType(ContainerType.MODEL, "Foo")),
    )
    assert contains_model(resolved_type) is True


def test_inner_type_model_passthrough():
    item_type = object()
    inner_type = get_inner_type(ResolvedType(ContainerType.MODEL, item_type))
    assert inner_type.type is item_type
    assert inner_type.primitive is False


@pytest.mark.parametrize("resolved_type,native_type", RESOLVED_TYPES)
def test_inner_type_primitive(resolved_type, native_type):
    inner_type = get_inner_type(resolved_type)
    assert inner_type.type == native_type
    assert inner_type.primitive is True


@pytest.mark.parametrize("resolved_type,native_type", RESOLVED_TYPES)
def test_inner_type_dict(resolved_type, native_type):
    inner_type = get_inner_type(ResolvedType(ContainerType.DICT, resolved_type))
    assert inner_type.type == native_type
    assert inner_type.classes == ["Map"]


@pytest.mark.parametrize("resolved_type,native_type", RESOLVED_TYPES)
def test_inner_type_list(resolved_type, native_type):
    inner_type = get_inner_type(ResolvedType(ContainerType.LIST, resolved_type))
    assert inner_type.type == native_type
    assert inner_type.classes == ["Array"]


@pytest.mark.parametrize("resolved_type,native_type", RESOLVED_TYPES)
def test_inner_type_set(resolved_type, native_type):
    inner_type = get_inner_type(ResolvedType(ContainerType.SET, resolved_type))
    assert inner_type.type == native_type
    assert inner_type.classes == ["Set"]


@pytest.mark.parametrize("resolved_type,_native_type", RESOLVED_TYPES)
def test_inner_type_multiple(resolved_type, _native_type):
    inner_type = get_inner_type(ResolvedType(ContainerType.MULTIPLE, resolved_type))
    assert inner_type.type == "object"
    assert inner_type.primitive is True


@pytest.mark.parametrize("resolved_type,_native_type", RESOLVED_TYPES)
def test_inner_type_unknown(resolved_type, _native_type):
    with pytest.raises(ValueError):
        get_inner_type(ResolvedType("foo", resolved_type))
