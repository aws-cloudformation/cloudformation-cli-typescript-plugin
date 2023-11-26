// This file represents a model built from a complex schema to test that ser/de is
// happening as expected
/* eslint-disable @typescript-eslint/no-use-before-define */
import { BaseModel, integer, Integer, Optional, transformValue } from '../../src';
import { Exclude, Expose, Transform, Type } from 'class-transformer';

export class ResourceModel extends BaseModel {
    declare ['constructor']: typeof ResourceModel;

    @Exclude()
    public static readonly TYPE_NAME: string = 'Organization::Service::ComplexResource';

    @Expose({ name: 'ListListAny' })
    @Transform(
        (value, obj) => {
            return transformValue(Object, 'listListAny', value, obj, [Array, Array]);
        },
        {
            toClassOnly: true,
        }
    )
    listListAny?: Optional<Array<Array<object>>>;
    @Expose({ name: 'ListSetInt' })
    @Transform(
        (value, obj) => transformValue(Integer, 'listSetInt', value, obj, [Array, Set]),
        {
            toClassOnly: true,
        }
    )
    listSetInt?: Optional<Array<Set<integer>>>;
    @Expose({ name: 'ListListInt' })
    @Transform(
        (value, obj) =>
            transformValue(Integer, 'listListInt', value, obj, [Array, Array]),
        {
            toClassOnly: true,
        }
    )
    listListInt?: Optional<Array<Array<integer>>>;
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
    @Transform((value, obj) => transformValue(Integer, 'anInt', value, obj), {
        toClassOnly: true,
    })
    anInt?: Optional<integer>;
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
    declare ['constructor']: typeof NestedList;

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
    declare ['constructor']: typeof AList;

    @Expose({ name: 'DeeperBool' })
    @Transform((value, obj) => transformValue(Boolean, 'deeperBool', value, obj), {
        toClassOnly: true,
    })
    deeperBool?: Optional<boolean>;
    @Expose({ name: 'DeeperList' })
    @Transform(
        (value, obj) => transformValue(Integer, 'deeperList', value, obj, [Array]),
        {
            toClassOnly: true,
        }
    )
    deeperList?: Optional<Array<integer>>;
    @Expose({ name: 'DeeperDictInList' })
    @Type(() => DeeperDictInList)
    deeperDictInList?: Optional<DeeperDictInList>;
}

export class DeeperDictInList extends BaseModel {
    declare ['constructor']: typeof DeeperDictInList;

    @Expose({ name: 'DeepestBool' })
    @Transform((value, obj) => transformValue(Boolean, 'deepestBool', value, obj), {
        toClassOnly: true,
    })
    deepestBool?: Optional<boolean>;
    @Expose({ name: 'DeepestList' })
    @Transform(
        (value, obj) => transformValue(Integer, 'deepestList', value, obj, [Array]),
        {
            toClassOnly: true,
        }
    )
    deepestList?: Optional<Array<integer>>;
}

export class ADict extends BaseModel {
    declare ['constructor']: typeof ADict;

    @Expose({ name: 'DeepBool' })
    @Transform((value, obj) => transformValue(Boolean, 'deepBool', value, obj), {
        toClassOnly: true,
    })
    deepBool?: Optional<boolean>;
    @Expose({ name: 'DeepList' })
    @Transform(
        (value, obj) => transformValue(Integer, 'deepList', value, obj, [Array]),
        {
            toClassOnly: true,
        }
    )
    deepList?: Optional<Array<integer>>;
    @Expose({ name: 'DeepDict' })
    @Type(() => DeepDict)
    deepDict?: Optional<DeepDict>;
}

export class DeepDict extends BaseModel {
    declare ['constructor']: typeof DeepDict;

    @Expose({ name: 'DeeperBool' })
    @Transform((value, obj) => transformValue(Boolean, 'deeperBool', value, obj), {
        toClassOnly: true,
    })
    deeperBool?: Optional<boolean>;
    @Expose({ name: 'DeeperList' })
    @Transform(
        (value, obj) => transformValue(Integer, 'deeperList', value, obj, [Array]),
        {
            toClassOnly: true,
        }
    )
    deeperList?: Optional<Array<integer>>;
    @Expose({ name: 'DeeperDict' })
    @Type(() => DeeperDict)
    deeperDict?: Optional<DeeperDict>;
}

export class DeeperDict extends BaseModel {
    declare ['constructor']: typeof DeeperDict;

    @Expose({ name: 'DeepestBool' })
    @Transform((value, obj) => transformValue(Boolean, 'deepestBool', value, obj), {
        toClassOnly: true,
    })
    deepestBool?: Optional<boolean>;
    @Expose({ name: 'DeepestList' })
    @Transform(
        (value, obj) => transformValue(Integer, 'deepestList', value, obj, [Array]),
        {
            toClassOnly: true,
        }
    )
    deepestList?: Optional<Array<integer>>;
}

export class TagsModel extends BaseModel {
    declare ['constructor']: typeof TagsModel;

    @Expose({ name: 'Tags' })
    @Transform((value, obj) => transformValue(Tag, 'tags', value, obj, [Set]), {
        toClassOnly: true,
    })
    tags?: Optional<Set<Tag>>;
}

class Tag extends BaseModel {
    declare ['constructor']: typeof Tag;

    @Expose({ name: 'Name' })
    name: string;
    @Expose({ name: 'Value' })
    value: string;
}

export class SimpleResourceModel extends BaseModel {
    declare ['constructor']: typeof SimpleResourceModel;

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

export class SimpleStateModel extends BaseModel {
    declare ['constructor']: typeof SimpleStateModel;

    @Exclude()
    public static readonly TYPE_NAME: string = 'Organization::Service::SimpleState';

    @Expose()
    @Transform((value, obj) => transformValue(String, 'state', value, obj), {
        toClassOnly: true,
    })
    state?: Optional<string>;
}

export class SerializableModel extends BaseModel {
    declare ['constructor']: typeof SerializableModel;
    public static readonly TYPE_NAME: string = 'Organization::Service::Serializable';

    @Expose() somekey?: Optional<string>;
    @Expose() somestring?: Optional<string>;
    @Expose() someotherkey?: Optional<string>;
    @Expose({ name: 'SomeInt' })
    @Transform((value, obj) => transformValue(Integer, 'someint', value, obj), {
        toClassOnly: true,
    })
    someint?: Optional<integer>;
}
