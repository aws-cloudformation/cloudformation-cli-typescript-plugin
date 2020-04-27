import { minToCron } from '../../src/utils';

describe('when getting utils', () => {
    test('minutes to cron', () => {
        const spy: jest.SpyInstance = jest
            .spyOn(global.Date, 'now')
            .mockImplementationOnce(() => {
                return new Date(2020, 1, 1, 1, 1).valueOf();
            });
        const cron = minToCron(1);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(cron).toBe('cron(3 1 1 1 ? 2020)');
    });
});
