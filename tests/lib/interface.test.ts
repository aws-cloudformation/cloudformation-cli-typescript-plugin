import { Integer, UnmodeledRequest } from '../../src/interface';
import { SerializableModel } from '../data/sample-model';

describe('when getting interface', () => {
    test('base resource model get type name', () => {
        const model = new SerializableModel();
        expect(model.getTypeName()).toBe(model.constructor.TYPE_NAME);
    });

    test('base resource model deserialize', () => {
        const model = SerializableModel.deserialize(null);
        expect(model).toBeNull();
    });

    test('base resource model serialize', () => {
        const model = SerializableModel.deserialize({
            somekey: 'a',
            somestring: '',
            someotherkey: null,
            someint: null,
        });
        const serialized = JSON.parse(JSON.stringify(model));
        expect(Object.keys(serialized).length).toBe(2);
        expect(serialized.somekey).toBe('a');
        expect(serialized.somestring).toBe('');
        expect(serialized.someotherkey).not.toBeDefined();
    });

    test('base resource model to plain object', () => {
        const model = SerializableModel.deserialize({
            somekey: 'a',
            someotherkey: 'b',
        });
        const obj = model.toJSON();
        expect(obj).toMatchObject({
            somekey: 'a',
            someotherkey: 'b',
        });
    });

    test('integer serialize from number to number', () => {
        const valueNumber = 123597129357;
        expect(typeof valueNumber).toBe('number');
        const valueInteger = Integer(valueNumber);
        expect(typeof valueInteger).toBe('bigint');
        const serialized = JSON.parse(JSON.stringify(valueInteger));
        expect(typeof serialized).toBe('number');
        expect(serialized).toBe(valueNumber);
    });

    test('integer serialize invalid number', () => {
        const parseInteger = () => {
            Integer(Math.pow(2, 53));
        };
        expect(parseInteger).toThrow(RangeError);
        expect(parseInteger).toThrow('Value is not a safe integer');
    });

    test('integer serialize from string to number', () => {
        const model = SerializableModel.deserialize({
            SomeInt: '35190274',
        });
        expect(model['someint']).toBe(Integer(35190274));
        const serialized = model.serialize();
        expect(typeof serialized['SomeInt']).toBe('number');
        expect(serialized['SomeInt']).toBe(35190274);
    });

    test('unmodeled request partion', () => {
        const partionMap = [null, 'aws', 'aws-cn', 'aws-gov'];
        [null, 'us-east-1', 'cn-region1', 'us-gov-region1'].forEach(
            (region: string, index: number) => {
                const partion = UnmodeledRequest.getPartition(region);
                expect(partion).toBe(partionMap[index]);
            }
        );
    });
});
