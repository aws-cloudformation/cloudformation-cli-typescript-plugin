// This is a generated file. Modifications will be overwritten.
import { BaseResourceModel, Optional } from '{{lib_name}}';
import { allArgsConstructor, builder } from 'tombok';

{% for model, properties in models.items() %}
@builder
@allArgsConstructor
export class {{ model|uppercase_first_letter }}{% if model == "ResourceModel" %} extends BaseResourceModel{% endif %} {
    public static typeName: string = '{{ type_name }}';

    {% for name, type in properties.items() %}
    {{ name|lowercase_first_letter|safe_reserved }}: Optional<{{ type|translate_type }}>;
    {% endfor %}
}

{% endfor -%}
