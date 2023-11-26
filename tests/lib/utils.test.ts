/* eslint-disable @typescript-eslint/no-empty-function */
import { deepFreeze, replaceAll } from '~/utils';

describe('when getting utils', () => {
    afterEach(() => {
        jest.clearAllMocks();
        jest.restoreAllMocks();
    });

    describe('replace all', () => {
        test('should skip replace falsy', () => {
            expect(replaceAll(null, null, null)).toBe(null);
            expect(replaceAll(undefined, null, null)).toBe(undefined);
            expect(replaceAll('', null, null)).toBe('');
        });

        test('should replace all occurrences', () => {
            const BEARER_TOKEN = 'ce1919f7-8f9b-43fd-881e-c616ca74c4d3';
            const SECRET_ACCESS_KEY = '66iOGPN5LnpZorcLr8Kh25u8AbjHVllv5/poh2O0';
            const SESSION_TOKEN =
                'lameHS2vQOknSHWhdFYTxm2eJc1JMn9YBNI4nV4mXue945KPL6DHfW8EsUQT5zwssYEC1NvYP9yD6Y5s5lKR3chflOHPFsIe6eqg\\.*+-?^${}()|[]';
            const input = `
            {
                awsAccountId: '123456789012',
                bearerToken: '${BEARER_TOKEN}',
                region: 'eu-central-1',
                action: 'CREATE',
                responseEndpoint: null,
                resourceType: 'Community::Monitoring::Website',
                resourceTypeVersion: '000001',
                callbackContext: null,
                requestData: {
                  callerCredentials: {
                      accessKeyId: '',
                      secretAccessKey: '${SECRET_ACCESS_KEY}',
                      sessionToken: '${SESSION_TOKEN}'
                  },
                  providerCredentials: {
                    accessKeyId: '',
                    secretAccessKey: '${SECRET_ACCESS_KEY}',
                    sessionToken: '${SESSION_TOKEN}'
                  },
                  providerLogGroupName: 'community-monitoring-website-logs',
                  logicalResourceId: 'MyResource',
                  resourceProperties: {
                      Name: 'MyWebsiteMonitor',
                      BerearToken: '${BEARER_TOKEN}'
                    },
                  previousResourceProperties: null,
                  stackTags: {},
                  previousStackTags: {}
                },
                stackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/SampleStack/e722ae60-fe62-11e8-9a0e-0ae8cc519968'
            }
            `;
            const expected = `
            {
                awsAccountId: '123456789012',
                bearerToken: '<REDACTED>',
                region: 'eu-central-1',
                action: 'CREATE',
                responseEndpoint: null,
                resourceType: 'Community::Monitoring::Website',
                resourceTypeVersion: '000001',
                callbackContext: null,
                requestData: {
                  callerCredentials: {
                      accessKeyId: '',
                      secretAccessKey: '<REDACTED>',
                      sessionToken: '<REDACTED>'
                  },
                  providerCredentials: {
                    accessKeyId: '',
                    secretAccessKey: '<REDACTED>',
                    sessionToken: '<REDACTED>'
                  },
                  providerLogGroupName: 'community-monitoring-website-logs',
                  logicalResourceId: 'MyResource',
                  resourceProperties: {
                      Name: 'MyWebsiteMonitor',
                      BerearToken: '<REDACTED>'
                    },
                  previousResourceProperties: null,
                  stackTags: {},
                  previousStackTags: {}
                },
                stackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/SampleStack/e722ae60-fe62-11e8-9a0e-0ae8cc519968'
            }
            `;
            expect(
                replaceAll(
                    replaceAll(
                        replaceAll(input, BEARER_TOKEN, '<REDACTED>'),
                        SECRET_ACCESS_KEY,
                        '<REDACTED>'
                    ),
                    SESSION_TOKEN,
                    '<REDACTED>'
                )
            ).toBe(expected);
        });
    });

    describe('deep freeze', () => {
        let obj;
        let circ1;
        let circ2;
        let proto;

        beforeEach(() => {
            obj = {};
            obj.first = {
                second: { third: { num: 11, fun() {} } },
            };

            circ1 = { first: { test: 1 } };
            circ2 = { second: { test: 2 } };

            // Create circular reference
            circ2.circ1 = circ1;
            circ1.circ2 = circ2;

            const ob1 = { proto: { test: { is: 1 } } };
            const ob2 = Object.create(ob1);
            ob2.ob2Prop = { prop: 'prop' };
            proto = Object.create(ob2);
            proto.child = { test: 1 };
            proto.fun = () => {};
        });

        test('should deep freeze nested objects', () => {
            deepFreeze(obj);
            expect(Object.isFrozen(obj.first.second)).toBe(true);
            expect(Object.isFrozen(obj.first.second.third)).toBe(true);
            expect(Object.isFrozen(obj.first.second.third.fun)).toBe(true);
        });

        test('should handle circular reference', () => {
            deepFreeze(circ1);
            expect(Object.isFrozen(circ1.first)).toBe(true);
            expect(Object.isFrozen(circ1.circ2)).toBe(true);
            expect(Object.isFrozen(circ1.circ2.second)).toBe(true);
        });

        test('should not freeze prototype chain', () => {
            deepFreeze(proto);
            expect(Object.isFrozen(proto)).toBe(true);
            expect(Object.isFrozen(proto.child)).toBe(true);
            expect(Object.isFrozen(proto.function)).toBe(true);
            expect(Object.isFrozen(proto.ob2Prop)).toBe(false);
            expect(Object.isFrozen(proto.proto.test)).toBe(false);
        });

        test('should not brake on restricted properties', () => {
            const fun = function () {};
            const funPrototype = Object.getPrototypeOf(fun);
            deepFreeze(funPrototype);
            expect(Object.isFrozen(funPrototype)).toBe(false);
        });

        test('should deep freeze object with null prototype', () => {
            const ob1 = Object.create(null);
            ob1.test = 'test';
            ob1.ob2 = Object.create(null);

            deepFreeze(ob1);
            expect(Object.isFrozen(ob1)).toBe(true);
            expect(Object.isFrozen(ob1.ob2)).toBe(true);
        });

        test('should deep freeze complex object', () => {
            const fun = () => {};
            const arr = [{ prop: { prop2: 1 } }];
            const set = new Set([{ prop: { prop2: 1 } }]);
            const ob = { arr, fun, set };

            fun.test = { prop: { prop2: 1 } };
            arr['test'] = { prop: { prop2: 1 } };
            set['test'] = { prop: { prop2: 1 } };

            deepFreeze(ob);
            expect(Object.isFrozen(ob)).toBe(true);
            expect(Object.isFrozen(ob.fun)).toBe(true);
            expect(Object.isFrozen(ob.fun.test)).toBe(true);
            expect(Object.isFrozen(ob.arr)).toBe(true);
            expect(Object.isFrozen(ob.arr['test'])).toBe(true);
            expect(Object.isFrozen(ob.arr['test'])).toBe(true);
            expect(Object.isFrozen(ob.set)).toBe(true);
            expect(Object.isFrozen(ob.set['test'])).toBe(true);
        });

        test('should deep freeze non enumerable properties', () => {
            Object.defineProperty(obj, 'nonEnumerable', {
                enumerable: false,
                value: {},
            });

            deepFreeze(obj);
            expect(Object.isFrozen(obj.nonEnumerable)).toBe(true);
        });

        test('should validate some examples', () => {
            const person = {
                fullName: 'test person',
                dob: new Date(),
                address: {
                    country: 'Croatia',
                    city: 'this one',
                },
            };

            Object.freeze(person);
            expect(Object.isFrozen(person)).toBe(true);
            expect(Object.isFrozen(person.address)).toBe(false);

            deepFreeze(person);
            expect(Object.isFrozen(person)).toBe(true);
            expect(Object.isFrozen(person.address)).toBe(true);

            const ob1 = { test: { a: 'a' } };
            const ob2 = Object.create(ob1);

            deepFreeze(ob2);

            expect(Object.isFrozen(ob2)).toBe(true);
            expect(Object.isFrozen(Object.getPrototypeOf(ob2))).toBe(false);
            expect(Object.isFrozen(ob1)).toBe(false);
            expect(Object.isFrozen(Object.getPrototypeOf(ob1))).toBe(false);
        });

        test('should freeze object with Symbol property', () => {
            const sim = Symbol('test');
            obj[sim] = {
                key: { test: 1 },
            };

            deepFreeze(obj);
            expect(Object.isFrozen(obj[sim].key)).toBe(true);
        });

        test('should not break for TypedArray properties', () => {
            obj.typedArray = new Uint32Array(4);
            obj.buffer = Buffer.from('TEST');

            deepFreeze(obj);
            expect(Object.isFrozen(obj)).toBe(true);
        });

        test('should deep freeze children of already frozen object', () => {
            Object.freeze(obj.first);

            deepFreeze(obj);
            expect(Object.isFrozen(obj.first.second)).toBe(true);
            expect(Object.isFrozen(obj.first.second.third)).toBe(true);
        });

        test('should not freeze object prototype', () => {
            deepFreeze(proto);
            expect(Object.isFrozen(proto)).toBe(true);
            expect(Object.isFrozen(Object.getPrototypeOf(proto))).toBe(false);
        });
    });
});
