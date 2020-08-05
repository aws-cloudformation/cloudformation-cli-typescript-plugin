from rpdk.core.jsonutils.resolver import UNDEFINED, ContainerType

PRIMITIVE_TYPES = {
    "string": "string",
    "integer": "integer",
    "boolean": "boolean",
    "number": "number",
    UNDEFINED: "object",
}
PRIMITIVE_WRAPPERS = {
    "string": "String",
    "integer": "Integer",
    "boolean": "Boolean",
    "number": "Number",
    "object": "Object",
}


class InnerType:
    def __init__(self, item_type):
        self.primitive = False
        self.classes = []
        self.type = self.resolve_type(item_type)
        self.wrapper_type = self.type
        if self.primitive:
            self.wrapper_type = PRIMITIVE_WRAPPERS[self.type]

    def resolve_type(self, resolved_type):
        if resolved_type.container == ContainerType.PRIMITIVE:
            self.primitive = True
            return PRIMITIVE_TYPES[resolved_type.type]
        if resolved_type.container == ContainerType.MULTIPLE:
            self.primitive = True
            return "object"
        if resolved_type.container == ContainerType.MODEL:
            return resolved_type.type
        if resolved_type.container == ContainerType.DICT:
            self.classes.append("Map")
        elif resolved_type.container == ContainerType.LIST:
            self.classes.append("Array")
        elif resolved_type.container == ContainerType.SET:
            self.classes.append("Set")
        else:
            raise ValueError(f"Unknown container type {resolved_type.container}")

        return self.resolve_type(resolved_type.type)


def get_inner_type(resolved_type):
    return InnerType(resolved_type)


def translate_type(resolved_type):
    if resolved_type.container == ContainerType.MODEL:
        return resolved_type.type
    if resolved_type.container == ContainerType.PRIMITIVE:
        return PRIMITIVE_TYPES[resolved_type.type]
    if resolved_type.container == ContainerType.MULTIPLE:
        return "object"

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
