from rpdk.core.jsonutils.resolver import UNDEFINED, ContainerType

PRIMITIVE_TYPES = {
    "string": "string",
    "integer": "number",
    "boolean": "boolean",
    "number": "number",
    UNDEFINED: "Object",
}


def translate_type(resolved_type):
    if resolved_type.container == ContainerType.MODEL:
        return resolved_type.type
    if resolved_type.container == ContainerType.PRIMITIVE:
        return PRIMITIVE_TYPES[resolved_type.type]

    item_type = translate_type(resolved_type.type)

    if resolved_type.container == ContainerType.DICT:
        key_type = PRIMITIVE_TYPES["string"]
        return f"Map<{key_type}, {item_type}>"
    if resolved_type.container == ContainerType.LIST:
        return f"Array<{item_type}>"
    if resolved_type.container == ContainerType.SET:
        return f"Set<{item_type}>"

    raise ValueError(f"Unknown container type {resolved_type.container}")


def contains_model(resolved_type):
    if resolved_type.container == ContainerType.LIST:
        return contains_model(resolved_type.type)
    return resolved_type.container == ContainerType.MODEL
