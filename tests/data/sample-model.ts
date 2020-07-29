// This file represents a model built from a complex schema to test that ser/de is
// happening as expected
/* eslint-disable @typescript-eslint/no-use-before-define */
import { BaseModel, Optional, transformValue } from '../../src';
import { Exclude, Expose, Transform, Type } from 'class-transformer';

export class ResourceModel extends BaseModel {
    ['constructor']: typeof ResourceModel;

    @Exclude()
    public static readonly TYPE_NAME: string = 'Organization::Service::ComplexResource';

    @Expose({ name: 'ListListAny' })
    @Transform(
        (value, obj) =>
            transformValue(Object, 'listListAny', value, obj, [Array, Array]),
        {
            toClassOnly: true,
        }
    )
    listListAny?: Optional<Array<Array<object>>>;
    @Expose({ name: 'ListSetInt' })
    @Transform(
        (value, obj) => transformValue(BigInt, 'listSetInt', value, obj, [Array, Set]),
        {
            toClassOnly: true,
        }
    )
    listSetInt?: Optional<Array<Set<bigint>>>;
    @Expose({ name: 'ListListInt' })
    @Transform(
        (value, obj) =>
            transformValue(BigInt, 'listListInt', value, obj, [Array, Array]),
        {
            toClassOnly: true,
        }
    )
    listListInt?: Optional<Array<Array<bigint>>>;
    @Expose({ name: 'ASet' })
    @Transform((value, obj) => transformValue(Object, 'aSet', value, obj, [Set]), {
        toClassOnly: true,
    })
    aSet?: Optional<Set<object>>;
    @Expose({ name: 'AnotherSet' })
    @Transform(
        (value, obj) => transformValue(String, 'anotherSet', value, obj, [Set]),
        {
            toClassOnly: true,
        }
    )
    anotherSet?: Optional<Set<string>>;
    @Expose({ name: 'AFreeformDict' })
    @Transform(
        (value, obj) => transformValue(Object, 'aFreeformDict', value, obj, [Map]),
        {
            toClassOnly: true,
        }
    )
    aFreeformDict?: Optional<Map<string, object>>;
    @Expose({ name: 'ANumberDict' })
    @Transform(
        (value, obj) => transformValue(Number, 'aNumberDict', value, obj, [Map]),
        {
            toClassOnly: true,
        }
    )
    aNumberDict?: Optional<Map<string, number>>;
    @Expose({ name: 'AnInt' })
    @Transform((value, obj) => transformValue(BigInt, 'anInt', value, obj), {
        toClassOnly: true,
    })
    anInt?: Optional<bigint>;
    @Expose({ name: 'ABool' })
    @Transform((value, obj) => transformValue(Boolean, 'aBool', value, obj), {
        toClassOnly: true,
    })
    aBool?: Optional<boolean>;
    @Expose({ name: 'NestedList' })
    @Type(() => NestedList)
    nestedList?: Optional<Array<Array<NestedList>>>;
    @Expose({ name: 'AList' })
    @Type(() => AList)
    aList?: Optional<Array<AList>>;
    @Expose({ name: 'ADict' })
    @Type(() => ADict)
    aDict?: Optional<Array<ADict>>;
}

export class NestedList extends BaseModel {
    ['constructor']: typeof NestedList;

    @Expose({ name: 'NestedListBool' })
    @Transform((value, obj) => transformValue(Boolean, 'nestedListBool', value, obj), {
        toClassOnly: true,
    })
    nestedListBool?: Optional<boolean>;
    @Expose({ name: 'NestedListList' })
    @Transform((value, obj) => transformValue(Number, 'nestedListList', value, obj), {
        toClassOnly: true,
    })
    nestedListList?: Optional<number>;
}

export class AList extends BaseModel {
    ['constructor']: typeof AList;

    @Expose({ name: 'DeeperBool' })
    @Transform((value, obj) => transformValue(Boolean, 'deeperBool', value, obj), {
        toClassOnly: true,
    })
    deeperBool?: Optional<boolean>;
    @Expose({ name: 'DeeperList' })
    @Transform(
        (value, obj) => transformValue(BigInt, 'deeperList', value, obj, [Array]),
        {
            toClassOnly: true,
        }
    )
    deeperList?: Optional<Array<bigint>>;
    @Expose({ name: 'DeeperDictInList' })
    @Type(() => DeeperDictInList)
    deeperDictInList?: Optional<DeeperDictInList>;
}

export class DeeperDictInList extends BaseModel {
    ['constructor']: typeof DeeperDictInList;

    @Expose({ name: 'DeepestBool' })
    @Transform((value, obj) => transformValue(Boolean, 'deepestBool', value, obj), {
        toClassOnly: true,
    })
    deepestBool?: Optional<boolean>;
    @Expose({ name: 'DeepestList' })
    @Transform(
        (value, obj) => transformValue(BigInt, 'deepestList', value, obj, [Array]),
        {
            toClassOnly: true,
        }
    )
    deepestList?: Optional<Array<bigint>>;
}

export class ADict extends BaseModel {
    ['constructor']: typeof ADict;

    @Expose({ name: 'DeepBool' })
    @Transform((value, obj) => transformValue(Boolean, 'deepBool', value, obj), {
        toClassOnly: true,
    })
    deepBool?: Optional<boolean>;
    @Expose({ name: 'DeepList' })
    @Transform(
        (value, obj) => transformValue(BigInt, 'deepList', value, obj, [Array]),
        {
            toClassOnly: true,
        }
    )
    deepList?: Optional<Array<bigint>>;
    @Expose({ name: 'DeepDict' })
    @Type(() => DeepDict)
    deepDict?: Optional<DeepDict>;
}

export class DeepDict extends BaseModel {
    ['constructor']: typeof DeepDict;

    @Expose({ name: 'DeeperBool' })
    @Transform((value, obj) => transformValue(Boolean, 'deeperBool', value, obj), {
        toClassOnly: true,
    })
    deeperBool?: Optional<boolean>;
    @Expose({ name: 'DeeperList' })
    @Transform(
        (value, obj) => transformValue(BigInt, 'deeperList', value, obj, [Array]),
        {
            toClassOnly: true,
        }
    )
    deeperList?: Optional<Array<bigint>>;
    @Expose({ name: 'DeeperDict' })
    @Type(() => DeeperDict)
    deeperDict?: Optional<DeeperDict>;
}

export class DeeperDict extends BaseModel {
    ['constructor']: typeof DeeperDict;

    @Expose({ name: 'DeepestBool' })
    @Transform((value, obj) => transformValue(Boolean, 'deepestBool', value, obj), {
        toClassOnly: true,
    })
    deepestBool?: Optional<boolean>;
    @Expose({ name: 'DeepestList' })
    @Transform(
        (value, obj) => transformValue(BigInt, 'deepestList', value, obj, [Array]),
        {
            toClassOnly: true,
        }
    )
    deepestList?: Optional<Array<bigint>>;
}

export class SimpleResourceModel extends BaseModel {
    ['constructor']: typeof SimpleResourceModel;

    @Exclude()
    public static readonly TYPE_NAME: string = 'Organization::Service::SimpleResource';

    @Expose({ name: 'ANumber' })
    @Transform((value, obj) => transformValue(Number, 'aNumber', value, obj), {
        toClassOnly: true,
    })
    aNumber?: Optional<number>;
    @Expose({ name: 'ABoolean' })
    @Transform((value, obj) => transformValue(Boolean, 'aBoolean', value, obj), {
        toClassOnly: true,
    })
    aBoolean?: Optional<boolean>;
}
