import { cwd } from 'node:process';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { relative, join, dirname } from 'node:path';
import { mkdir, rm, readFile, writeFile } from 'node:fs/promises';

const projectRoot = cwd();
const packageJsonPath = join(projectRoot, 'package.json');
const temporaryDeclarationDirectory = join(projectRoot, '.types-build');
const isRecord = (value: unknown): value is Record<string, unknown> => !Array.isArray(value) && typeof value === 'object' && value !== null;
const parsedPackageJson: unknown = JSON.parse(await readFile(packageJsonPath, 'utf8'));
if (!isRecord(parsedPackageJson)) { throw new TypeError('package.json must contain an object') }
const packageJson = parsedPackageJson;
const typeEntries = new Map<string, string>();

const readTemporaryDeclaration = async (relativePath: string) => readFile(join(temporaryDeclarationDirectory, relativePath), 'utf8');

const extractTypeDeclaration = (source: string, name: string) => {
	const marker = new RegExp(`^(?:export )?type ${name}(?:<[^\\n]+>)? = `, 'm');
	const match = marker.exec(source);

	if (!match || match.index === undefined) {
		throw new Error(`Unable to find type declaration for ${name}`);
	}

	const startIndex = match.index;
	const nextMatch = /\n(?:export )?type /g;
	nextMatch.lastIndex = startIndex + 1;
	const nextIndex = nextMatch.exec(source)?.index;

	return source.slice(startIndex, nextIndex).trimEnd();
};

const buildTypeDeclarations = (sharedTypesDeclaration: string, exportedTypeNames: string[]) => {
	const allTypeNames = Array.from(sharedTypesDeclaration.matchAll(/^(?:export )?type ([A-Za-z0-9_]+)(?:<[^\n]+>)? = /gm)).map(([, typeName]) => typeName!);
	const declarationByTypeName = new Map(allTypeNames.map(typeName => [typeName, extractTypeDeclaration(sharedTypesDeclaration, typeName)]));
	const exportedTypeNameSet = new Set(exportedTypeNames);
	const includedTypeNameSet = new Set<string>();
	const orderedTypeNames: string[] = [];

	const includeWithDependencies = (typeName: string) => {
		if (includedTypeNameSet.has(typeName)) { return }

		const declaration = declarationByTypeName.get(typeName);
		if (!declaration) { throw new Error(`Unable to find type declaration for ${typeName}`) }

		for (const dependencyName of allTypeNames) {
			if (dependencyName !== typeName && new RegExp(`\\b${dependencyName}\\b`).test(declaration)) {
				includeWithDependencies(dependencyName);
			}
		}

		includedTypeNameSet.add(typeName);
		orderedTypeNames.push(typeName);
	};

	for (const exportedTypeName of exportedTypeNames) {
		includeWithDependencies(exportedTypeName);
	}

	return orderedTypeNames.map((name) => {
		const declaration = declarationByTypeName.get(name)!;
		return exportedTypeNameSet.has(name) ? declaration : declaration.replace(/^export /, '');
	});
};

const buildApiIndexDeclaration = async () => {
	const [ apiIndexDeclaration, registerDeclaration, sharedTypesDeclaration ] = await Promise.all([
		readTemporaryDeclaration(join('api', 'index.d.ts')),
		readTemporaryDeclaration(join('api', 'register.d.ts')),
		readTemporaryDeclaration('types.d.ts')
	]);

	const registerDeclarations = registerDeclaration.split('\n').filter((line) => line.startsWith('export declare function register('));

	if (registerDeclarations.length === 0) { throw new Error('Unable to find register function declarations') }

	const tsImportMatch = apiIndexDeclaration.match(/export declare const tsImport:[\s\S]*?;$/m);

	if (!tsImportMatch) { throw new Error('Unable to find tsImport declaration') }

	const declarationSections = [
		...buildTypeDeclarations(sharedTypesDeclaration, [
			'ModuleNamespace',
			'NamespacedUnregister',
			'OnImport',
			'Register',
			'RegisterHandle',
			'RegisterOptions',
			'ScopedImport',
			'ModuleImport',
			'TsImportOptions',
			'Unregister'
		]),
		...registerDeclarations,
		tsImportMatch[0]
	];

	return `${declarationSections.join('\n\n')}\n`;
};

const buildLoaderDeclaration = async () => {
	const [loaderDeclaration, sharedTypesDeclaration] = await Promise.all([ readTemporaryDeclaration('loader.d.ts'), readTemporaryDeclaration('types.d.ts') ]);

	const reExportMatch = loaderDeclaration.match(/export type \{([\s\S]*?)\} from ['"]\.\/types['"];?/m);

	if (!reExportMatch) { throw new Error('Unable to find loader type re-export declaration') }

	const exportedTypeNames = reExportMatch[1]!.split(',').map((name) => name.trim()).filter(Boolean);

	return `${buildTypeDeclarations(sharedTypesDeclaration, exportedTypeNames).join('\n\n')}\n`;
};

const validatePublicDeclaration = (relativePath: string, declaration: string) => {
	if (/(?:from\s+|import\()['"]\.{1,2}\//.test(declaration)) {
		throw new Error(`Declaration output ${relativePath} still references internal files and needs bundling support.`);
	}
};

const writePublicDeclaration = async (sourcePath: string, outputPath: string) => {
	const relativePath = relative(join(projectRoot, 'src'), sourcePath).replace(/\.ts$/, '.d.ts');
	const temporaryOutputPath = join(temporaryDeclarationDirectory, relativePath);

	await mkdir(dirname(outputPath), { recursive: true });
	let declaration: string;

	if (relativePath === join('api', 'index.d.ts')) {
		declaration = await buildApiIndexDeclaration();
	} else if (relativePath === 'loader.d.ts') {
		declaration = await buildLoaderDeclaration();
	} else {
		declaration = await readFile(temporaryOutputPath, 'utf8');
	}

	validatePublicDeclaration(relativePath, declaration);
	await writeFile(outputPath, declaration);
};

const addTypeEntry = (target: unknown) => {
	if (typeof target !== 'string') { return }

	if (!target.startsWith('./dist/') || !target.endsWith('.d.ts')) { return }

	const relativeWithoutExtension = target.slice('./dist/'.length, -'.d.ts'.length);
	const sourcePath = join(projectRoot, 'src', `${relativeWithoutExtension}.ts`);

	if (!existsSync(sourcePath)) { throw new Error(`No source file found for declaration output ${target}`) }

	typeEntries.set(sourcePath, join(projectRoot, target.slice(2)));
};

const collectTypeTargets = (exportValue: unknown) => {
	if (typeof exportValue === 'string' || Array.isArray(exportValue) || !exportValue) {
		return;
	}

	if (typeof exportValue === 'object' && 'types' in exportValue) {
		addTypeEntry(exportValue.types);
	}
};

addTypeEntry(packageJson['types']);

for (const exportValue of Object.values(isRecord(packageJson['exports']) ? packageJson['exports'] : {})) {
	collectTypeTargets(exportValue);
}

if (typeEntries.size === 0) {
	throw new Error('No declaration entry points could be resolved from package.json type targets.');
}

const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const run = (args: string[]) => {
	const { status } = spawnSync(command, args, { stdio: 'inherit', env: process.env });

	if (status !== 0) {
		throw new Error(`Command failed with exit code ${status ?? 1}: ${command} ${args.join(' ')}`);
	}
};

await rm(temporaryDeclarationDirectory, { recursive: true, force: true });

try {
	run([
		'tsc',
		'--ignoreConfig',
		'--declaration',
		'--emitDeclarationOnly',
		'--noCheck',
		'--rootDir',
		'src',
		'--outDir',
		temporaryDeclarationDirectory,
		'--module',
		'preserve',
		'--target',
		'esnext',
		'--lib',
		'esnext',
		'--types',
		'node',
		...typeEntries.keys()
	]);

	for (const [ sourcePath, outputPath ] of typeEntries) {
		await writePublicDeclaration(sourcePath, outputPath);
	}
} finally {
	await rm(temporaryDeclarationDirectory, { recursive: true, force: true });
}
