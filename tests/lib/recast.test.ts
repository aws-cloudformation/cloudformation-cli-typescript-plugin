import * as exceptions from '../../src/exceptions';
import { transformValue, recastPrimitive } from '../../src/recast';
import {
    ResourceModel as ComplexResourceModel,
    SimpleResourceModel,
} from '../data/sample-model';

describe('when recasting objects', () => {
    beforeAll(() => {});

    afterEach(() => {
        jest.clearAllMocks();
        jest.restoreAllMocks();
    });

    test('recast simple object', () => {
        const payload = {
            ANumber: '12.54',
            ABoolean: 'false',
        };
        const expected = {
            ANumber: 12.54,
            ABoolean: false,
        };
        const model = SimpleResourceModel.deserialize(payload);
        expect(model.toJSON()).toMatchObject(expected);
        const serialized = JSON.parse(JSON.stringify(model));
        expect(serialized).toMatchObject(expected);
    });

    test('recast complex object', () => {
        const payload = {
            ListListAny: [[{ key: 'val' }]],
            ListListInt: [['1', '2', '3']],
            ListSetInt: [['1', '2', '3']],
            ASet: ['1', '2', '3'],
            AnotherSet: ['a', 'b', 'c'],
            AFreeformDict: { somekey: 'somevalue', someotherkey: '1' },
            ANumberDict: { key: '52.76' },
            AnInt: '1',
            ABool: 'true',
            AList: [
                {
                    DeeperBool: 'false',
                    DeeperList: ['1', '2', '3'],
                    DeeperDictInList: { DeepestBool: 'true', DeepestList: ['3', '4'] },
                },
                { DeeperDictInList: { DeepestBool: 'false', DeepestList: ['6', '7'] } },
            ],
            ADict: {
                DeepBool: 'true',
                DeepList: ['10', '11'],
                DeepDict: {
                    DeeperBool: 'false',
                    DeeperList: ['1', '2', '3'],
                    DeeperDict: { DeepestBool: 'true', DeepestList: ['13', '17'] },
                },
            },
            NestedList: [
                [{ NestedListBool: 'true', NestedListList: ['1', '2', '3'] }],
                [{ NestedListBool: 'false', NestedListList: ['11', '12', '13'] }],
            ],
        };
        const expected = {
            ListSetInt: [[1, 2, 3]],
            ListListInt: [[1, 2, 3]],
            ListListAny: [[{ key: 'val' }]],
            ASet: ['1', '2', '3'],
            AnotherSet: ['a', 'b', 'c'],
            AFreeformDict: { somekey: 'somevalue', someotherkey: '1' },
            ANumberDict: { key: 52.76 },
            AnInt: 1,
            ABool: true,
            AList: [
                {
                    DeeperBool: false,
                    DeeperList: [1, 2, 3],
                    DeeperDictInList: { DeepestBool: true, DeepestList: [3, 4] },
                },
                { DeeperDictInList: { DeepestBool: false, DeepestList: [6, 7] } },
            ],
            ADict: {
                DeepBool: true,
                DeepList: [10, 11],
                DeepDict: {
                    DeeperBool: false,
                    DeeperList: [1, 2, 3],
                    DeeperDict: { DeepestBool: true, DeepestList: [13, 17] },
                },
            },
            NestedList: [
                [{ NestedListBool: true, NestedListList: [1.0, 2.0, 3.0] }],
                [{ NestedListBool: false, NestedListList: [11.0, 12.0, 13.0] }],
            ],
        };
        const model = ComplexResourceModel.deserialize(payload);
        const serialized = JSON.parse(JSON.stringify(model));
        expect(serialized).toMatchObject(expected);
        // re-invocations should not fail because they already type-cast payloads
        expect(ComplexResourceModel.deserialize(serialized).serialize()).toMatchObject(
            expected
        );
    });

    test('recast object invalid sub type', () => {
        const k = 'key';
        const v = { a: 1, b: 2 };
        const recastObject = () => {
            transformValue(SimpleResourceModel, k, v, {});
        };
        expect(recastObject).toThrow(exceptions.InvalidRequest);
        expect(recastObject).toThrow(
            `Unsupported type: ${typeof v} [${SimpleResourceModel.name}] for ${k}`
        );
    });

    test('recast primitive object type', () => {
        const k = 'key';
        const v = '{"a":"b"}';
        const value = recastPrimitive(Object, k, v);
        expect(value).toBe(v);
    });

    test('recast primitive boolean invalid value', () => {
        const k = 'key';
        const v = 'not-a-bool';
        const recastingPrimitive = () => {
            recastPrimitive(Boolean, k, v);
        };
        expect(recastingPrimitive).toThrow(exceptions.InvalidRequest);
        expect(recastingPrimitive).toThrow(`Value for ${k} "${v}" is not boolean`);
    });

    test('recast primitive number valid value', () => {
        const k = 'key';
        const v = '1252.53';
        const num = recastPrimitive(Number, k, v);
        expect(num).toBe(1252.53);
    });
});
