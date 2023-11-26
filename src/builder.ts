// Lombok style builder that was part of the legacy plugin as
// part of the abandoned package @org-formation/tombok
// Copied here and kept for ease of transition

/**
 * The builder decorator creates a so-called 'builder' aspect to the class that is annotated with `@builder`.
 *
 * Whenever a class is decorated, the private constructor is generated with all fields as arguments,
 * and it is as if this constructor has been decorated with `@builder` instead.
 * Note that this constructor is only generated if you haven't written any constructors and also haven't
 * added any explicit `@xArgsConstructor` decorators. In those cases, tombok will assume an all-args
 * constructor is present and generate code that uses it; this means you'd get a compiler error if this
 * constructor is not present.
 *
 * The effect of `@builder` is that an inner class is generated named `TBuilder`,
 * with a private constructor. Instances of `TBuilder` are made with the method named
 * `builder()` which is also generated for you in the class itself (not in the builder class).
 *
 * The `TBuilder` class contains 1 method for each parameter of the decorated class, which returns
 * the builder itself. The builder also has a `build()` method which returns a completed instance of
 * the original type, created by passing all parameters as set via the various other methods in the
 * builder to the constructor or method that was decorated with `@builder`. The return type of this
 * method will be the same as the relevant class, unless a method has been decorated, in which case
 * it'll be equal to the return type of that method.
 *
 * Example:
 * ```typescript
 * ＠builder
 * class Person {}
 *
 * Person.builder()
 *   .name('Adam Savage').city('San Francisco')
 *   .job('Mythbusters').job('Unchained Reaction')
 *   .build();
 * ```
 *
 * @param <T> Type of the base class that must contain a constructor
 * @param {T} target Base class that we are going to mutate
 */
export function builder<T extends new (...args: any) => any>(target: T): T {
    return class TBuilder extends target {
        /**
         * Create a Builder for a class. Returned objects will be of the class type.
         *
         * @param <T> The class to instantiate.
         * @param {Partial<T>} [template] Class partial which the builder will derive initial params from.
         */
        static builder(template) {
            const built = template ? Object.assign({}, template) : {};
            const builder = new Proxy(
                {},
                {
                    get(_, prop) {
                        if ('build' === prop) {
                            // Instantiate the input class with props
                            const obj = new target();
                            return () => Object.assign(obj, { ...built });
                        }
                        return (x) => {
                            built[prop] = x;
                            return builder;
                        };
                    },
                }
            );
            return builder;
        }
    };
}

export type IBuilder<T> = {
    [k in keyof T]-?: (arg: T[k]) => IBuilder<T>;
} & {
    build(): T;
};
