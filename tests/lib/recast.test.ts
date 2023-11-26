import * as exceptions from '~/exceptions';
import { transformValue, recastPrimitive } from '~/recast';
import {
    ResourceModel as ComplexResourceModel,
    SimpleResourceModel,
    TagsModel,
} from '../data/sample-model';

describe('when recasting objects', () => {
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
            ListListInt: [['1', '2', '3', '']],
            ListSetInt: [['1', '2', '3']],
            ASet: ['1', '2', '3'],
            AnotherSet: ['a', 'b', 'c', ''],
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
            ListSetInt: [new Set([1, 2, 3])],
            ListListInt: [[1, 2, 3, null]],
            ListListAny: [[{ key: 'val' }]],
            ASet: new Set(['1', '2', '3']),
            AnotherSet: new Set(['a', 'b', 'c', '']),
            AFreeformDict: new Map([
                ['somekey', 'somevalue'],
                ['someotherkey', '1'],
            ]),
            ANumberDict: new Map([['key', 52.76]]),
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

    test('recast set type - array with unique items', () => {
        const payload = {
            Tags: [{ key: 'name', value: 'value' }],
        };
        const expected = {
            Tags: new Set([{ key: 'name', value: 'value' }]),
        };
        const model = TagsModel.deserialize(payload);
        const serialized = JSON.parse(JSON.stringify(model));
        expect(serialized).toMatchObject(expected);
        expect(TagsModel.deserialize(serialized).serialize()).toMatchObject(expected);
    });

    test('recast object invalid sub type', () => {
        class InvalidClass {}
        const k = 'key';
        const v = { a: 1, b: 2 };
        const recastObject = () => {
            transformValue(InvalidClass, k, v, {});
        };
        expect(recastObject).toThrow(exceptions.InvalidRequest);
        expect(recastObject).toThrow(
            `Unsupported type: ${typeof v} [${InvalidClass.name}] for ${k}`
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

    test('recast primitive boolean/number empty string', () => {
        const k = 'key';
        const v = '';
        const bool = recastPrimitive(Boolean, k, v);
        const num = recastPrimitive(Number, k, v);
        const int = recastPrimitive(BigInt, k, v);
        const string = recastPrimitive(String, k, v);
        expect(bool).toBeNull();
        expect(num).toBeNull();
        expect(int).toBeNull();
        expect(string).toBe('');
    });
});
