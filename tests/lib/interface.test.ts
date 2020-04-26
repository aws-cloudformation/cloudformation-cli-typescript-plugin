import { BaseResourceModel, Optional } from '../../src/interface';

describe('when getting interface', () => {
    class ResourceModel extends BaseResourceModel {
        ['constructor']: typeof ResourceModel;
        public static readonly TYPE_NAME: string = 'Test::Resource::Model';

        public somekey: Optional<string>;
        public someotherkey: Optional<string>;
    }

    test('base resource model get type name', () => {
        const model = new ResourceModel();
        expect(model.getTypeName()).toBe(model.constructor.TYPE_NAME);
    });

    test('base resource model deserialize', () => {
        expect(() => ResourceModel.deserialize(null)).toThrow(
            'Cannot convert undefined or null to object'
        );
    });

    test('base resource model serialize', () => {
        const model = new ResourceModel(
            new Map(
                Object.entries({
                    somekey: 'a',
                    someotherkey: null,
                })
            )
        );
        const serialized = model.serialize();
        expect(serialized.size).toBe(1);
        expect(serialized.get('someotherkey')).not.toBeDefined();
    });

    test('base resource model to object', () => {
        const model = new ResourceModel(
            new Map(
                Object.entries({
                    somekey: 'a',
                    someotherkey: 'b',
                })
            )
        );
        const obj = model.toObject();
        expect(obj).toMatchObject({
            somekey: 'a',
            someotherkey: 'b',
        });
    });
});
