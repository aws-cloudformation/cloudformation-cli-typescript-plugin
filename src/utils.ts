/**
 * Convert minutes to a valid scheduling expression to be used in the AWS Events
 *
 * @param {number} minutes Minutes to be converted
 * @deprecated
 */
export function minToCron(minutes: number): string {
    const date = new Date(Date.now());
    // add another minute, as per java implementation
    date.setMinutes(date.getMinutes() + minutes + 1);
    return `cron(${date.getMinutes()} ${date.getHours()} ${date.getDate()} ${date.getMonth()} ? ${date.getFullYear()})`;
}

/**
 * Wait for a specified amount of time.
 *
 * @param {number} seconds Seconds that we will wait
 */
export async function delay(seconds: number): Promise<void> {
    return new Promise((_) => setTimeout(() => _(), seconds * 1000));
}
