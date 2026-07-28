import { loadTsconfig } from '../utils/tsconfig';
import type { RegisterOptions, TsconfigOptions } from '../types';
type Data = {
    active: boolean;
    hasLoadedTsconfig: boolean;
    namespace?: string;
    onImport?: (url: string) => void;
    virtualSources?: Map<string, string>;
    parsedTsconfig: ReturnType<typeof loadTsconfig>;
    tsconfig?: TsconfigOptions;
};
export type { Data };
export declare const ensureParsedTsconfig: (data: Data) => (Required<{
    compilerOptions?: {
        paths?: Record<string, string[]>;
        baseUrl?: string;
        allowJs?: boolean;
    };
}> & {
    compilerOptions: Required<{
        paths?: Record<string, string[]>;
        baseUrl?: string;
        allowJs?: boolean;
    }>;
}) | undefined;
export declare const createData: (options?: RegisterOptions) => Data;
