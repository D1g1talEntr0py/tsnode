/**
 * Creates a "branded" type with nominal typing.
 * This adds a unique, non-existent property to 'T' to make it
 * incompatible with other types that are structurally the same.
 *
 * @template T - The base type to brand
 * @template U - The brand identifier (symbol type or any other type)
 *
 * @example Symbol brands (stronger nominal typing):
 * declare const PathSymbol: unique symbol;
 * type Path = Brand<string, typeof PathSymbol>;
 *
 * @example Generic brands:
 * type JsonString<T> = Brand<string, T>;
 */
type Brand<T, U> = U extends symbol ? T & { readonly [K in U]: true } : T & { readonly __brand: U };

// JSON types
export type JsonString<T> = Brand<string, T>;

/**
 * A utility class for JSON serialization and deserialization.
 */
export class Json {
	/**
	 * Parse a JSON string into an object of type T.
	 * @param jsonString The JSON string to parse.
	 */
	static parse<T>(jsonString: JsonString<T>) {
		return JSON.parse(jsonString) as T;
	}

	/**
	 * Serialize an object of type T into a JSON string.
	 * @param data The object to serialize.
	 */
	static serialize<T>(data: T) {
		return JSON.stringify(data) as JsonString<T>;
	}
}