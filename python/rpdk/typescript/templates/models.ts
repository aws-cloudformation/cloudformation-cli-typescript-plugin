// This is a generated file. Modifications will be overwritten.
import { BaseModel, Dict, integer, Integer, Optional, transformValue } from '{{lib_name}}';
import { Exclude, Expose, Type, Transform, TransformFnParams } from 'class-transformer';

{% for model, properties in models.items() %}
export class {{ model|uppercase_first_letter }} extends BaseModel {
    {% if model == "ResourceModel" %}
    @Exclude()
    public static readonly TYPE_NAME: string = '{{ type_name }}';

    {% for identifier in primaryIdentifier %}
    {% set components = identifier.split("/") %}
    @Exclude()
    protected readonly IDENTIFIER_KEY_{{ components[2:]|join('_')|upper }}: string = '{{ identifier }}';
    {% endfor -%}

    {% for identifiers in additionalIdentifiers %}
    {% for identifier in identifiers %}
    {% set components = identifier.split("/") %}
    @Exclude()
    protected readonly IDENTIFIER_KEY_{{ components[2:]|join('_')|upper }}: string = '{{ identifier }}';
    {% endfor %}
    {% endfor %}
    {% endif %}

    {% for name, type in properties.items() %}
    {% set translated_type = type|translate_type %}
    {% set inner_type = type|get_inner_type %}
    @Expose({ name: '{{ name }}' })
    {% if type|contains_model %}
    @Type(() => {{ inner_type.type }})
    {% else %}
    @Transform(
        (params: TransformFnParams) =>
            transformValue({{ inner_type.wrapper_type }}, '{{ name|lowercase_first_letter|safe_reserved }}', params.value, params.obj, [{{ inner_type.classes|join(', ') }}]),
        {
            toClassOnly: true,
        }
    )
    {% endif %}
    {{ name|lowercase_first_letter|safe_reserved }}?: Optional<{{ translated_type }}>;
    {% endfor %}

    {% if model == "ResourceModel" %}
    @Exclude()
    public getPrimaryIdentifier(): Dict {
        const identifier: Dict = {};
        {% for identifier in primaryIdentifier %}
        {% set components = identifier.split("/") %}
        if (this.{{components[2]|lowercase_first_letter}} != null
            {%- for i in range(4, components|length + 1) -%}
                {#- #} && this
                {%- for component in components[2:i] -%} .{{component|lowercase_first_letter}} {%- endfor -%}
                {#- #} != null
            {%- endfor -%}
        ) {
            identifier[this.IDENTIFIER_KEY_{{ components[2:]|join('_')|upper }}] = this{% for component in components[2:] %}.{{component|lowercase_first_letter}}{% endfor %};
        }

        {% endfor %}
        // only return the identifier if it can be used, i.e. if all components are present
        return Object.keys(identifier).length === {{ primaryIdentifier|length }} ? identifier : null;
    }

    @Exclude()
    public getAdditionalIdentifiers(): Array<Dict> {
        const identifiers: Array<Dict> = new Array<Dict>();
        {% for identifiers in additionalIdentifiers %}
        if (this.getIdentifier {%- for identifier in identifiers -%} _{{identifier.split("/")[-1]|uppercase_first_letter}} {%- endfor -%} () != null) {
            identifiers.push(this.getIdentifier{% for identifier in identifiers %}_{{identifier.split("/")[-1]|uppercase_first_letter}}{% endfor %}());
        }
        {% endfor %}
        // only return the identifiers if any can be used
        return identifiers.length === 0 ? null : identifiers;
    }
    {% for identifiers in additionalIdentifiers %}

    @Exclude()
    public getIdentifier {%- for identifier in identifiers -%} _{{identifier.split("/")[-1]|uppercase_first_letter}} {%- endfor -%} (): Dict {
        const identifier: Dict = {};
        {% for identifier in identifiers %}
        {% set components = identifier.split("/") %}
        if ((this as any).{{components[2]|lowercase_first_letter}} != null
            {%- for i in range(4, components|length + 1) -%}
                {#- #} && (this as any)
                {%- for component in components[2:i] -%} .{{component|lowercase_first_letter}} {%- endfor -%}
                {#- #} != null
            {%- endfor -%}
        ) {
            identifier[this.IDENTIFIER_KEY_{{ components[2:]|join('_')|upper }}] = (this as any){% for component in components[2:] %}.{{component|lowercase_first_letter}}{% endfor %};
        }

        {% endfor %}
        // only return the identifier if it can be used, i.e. if all components are present
        return Object.keys(identifier).length === {{ identifiers|length }} ? identifier : null;
    }
    {% endfor %}
    {% endif %}
}

{% endfor -%}
