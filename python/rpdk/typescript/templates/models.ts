// This is a generated file. Modifications will be overwritten.
import { BaseResourceModel, Optional } from '{{lib_name}}';

{% for model, properties in models.items() %}
export class {{ model|uppercase_first_letter }}{% if model == "ResourceModel" %} extends BaseResourceModel{% endif %} {
    ['constructor']: typeof {{ model|uppercase_first_letter }};
    public static readonly TYPE_NAME: string = '{{ type_name }}';

    {% for name, type in properties.items() %}
    {{ name|safe_reserved }}: Optional<{{ type|translate_type }}>;
    {% endfor %}
}

{% endfor -%}
