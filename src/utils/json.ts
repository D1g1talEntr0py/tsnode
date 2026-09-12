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

export type JsonDecoder<T> = (value: unknown) => T | undefined;

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/**
 * A utility class for JSON serialization and deserialization.
 */
export class Json {
	/**
	 * Parse a JSON string without claiming a decoded shape.
	 * @param jsonString The JSON string to parse.
	 */
	static parse(jsonString: string): JsonValue {
		return JSON.parse(jsonString) as JsonValue;
	}

	/**
	 * Parse and decode a JSON string.
	 * @param jsonString The JSON string to parse.
	 * @param decoder Validates and converts the parsed value.
	 */
	static decode<T>(jsonString: string, decoder: JsonDecoder<T>): T | undefined {
		return decoder(Json.parse(jsonString));
	}

	/**
	 * Serialize an object of type T into a JSON string.
	 * @param data The object to serialize.
	 */
	static serialize<T>(data: T) {
		return JSON.stringify(data) as JsonString<T>;
	}
}