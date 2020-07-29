import { BaseModel, Optional } from '../../src/interface';

describe('when getting interface', () => {
    class ResourceModel extends BaseModel {
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
        const model = ResourceModel.deserialize(null);
        expect(model).toBeNull();
    });

    test('base resource model serialize', () => {
        const model = ResourceModel.deserialize({
            somekey: 'a',
            someotherkey: null,
        });
        const serialized = JSON.parse(JSON.stringify(model));
        expect(Object.keys(serialized).length).toBe(1);
        expect(serialized.someotherkey).not.toBeDefined();
    });

    test('base resource model to object', () => {
        const model = new ResourceModel({
            somekey: 'a',
            someotherkey: 'b',
        });
        const obj = model.toObject();
        expect(obj).toMatchObject({
            somekey: 'a',
            someotherkey: 'b',
        });
    });
});
