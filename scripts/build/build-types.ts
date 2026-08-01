import { spawnSync } from 'node:child_process';
import { cwd } from 'node:process';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

const projectRoot = cwd();
const packageJsonPath = path.join(projectRoot, 'package.json');
const temporaryDeclarationDirectory = path.join(projectRoot, '.types-build');
const packageJson = JSON.parse(await fsPromises.readFile(packageJsonPath, 'utf8'));
const typeEntries = new Map<string, string>();

const readTemporaryDeclaration = async (relativePath: string) => fsPromises.readFile(path.join(temporaryDeclarationDirectory, relativePath), 'utf8');

const extractTypeDeclaration = (source: string, name: string) => {
	const marker = new RegExp(`^export type ${name}(?:<[^\\n]+>)? = `, 'm');
	const match = marker.exec(source);

	if (!match || match.index === undefined) {
		throw new Error(`Unable to find type declaration for ${name}`);
	}

	const startIndex = match.index;
	const nextIndex = source.indexOf('\nexport type ', startIndex + 1);

	return source.slice(startIndex, nextIndex === -1 ? undefined : nextIndex).trimEnd();
};

const buildApiIndexDeclaration = async () => {
	const [apiIndexDeclaration, registerDeclaration, sharedTypesDeclaration] = await Promise.all([
		readTemporaryDeclaration(path.join('api', 'index.d.ts')),
		readTemporaryDeclaration(path.join('api', 'register.d.ts')),
		readTemporaryDeclaration('types.d.ts'),
	]);

	const optionsMatch = apiIndexDeclaration.match(/type Options = [\s\S]*?^};/m);
	if (!optionsMatch) {
		throw new Error('Unable to find api/index Options type declaration');
	}

	const registerDeclarations = registerDeclaration
		.split('\n')
		.filter(line => line.startsWith('export declare function register('));

	if (registerDeclarations.length === 0) {
		throw new Error('Unable to find register function declarations');
	}

	const tsImportMatch = apiIndexDeclaration.match(/export declare const tsImport:[\s\S]*?;$/m);
	if (!tsImportMatch) {
		throw new Error('Unable to find tsImport declaration');
	}

	const declarationSections = [
		extractTypeDeclaration(sharedTypesDeclaration, 'TsconfigOptions').replace(/^export /, ''),
		extractTypeDeclaration(sharedTypesDeclaration, 'RegisterOptions'),
		extractTypeDeclaration(sharedTypesDeclaration, 'Unregister'),
		extractTypeDeclaration(sharedTypesDeclaration, 'ScopedImport').replace(/^export /, ''),
		extractTypeDeclaration(sharedTypesDeclaration, 'RegisterHandle'),
		extractTypeDeclaration(sharedTypesDeclaration, 'NamespacedUnregister'),
		extractTypeDeclaration(sharedTypesDeclaration, 'RequiredProperty').replace(/^export /, ''),
		extractTypeDeclaration(sharedTypesDeclaration, 'Register'),
		optionsMatch[0],
		...registerDeclarations,
		tsImportMatch[0],
	];

	return `${declarationSections.join('\n\n')}\n`;
};

const buildLoaderDeclaration = async () => {
	const [loaderDeclaration, sharedTypesDeclaration] = await Promise.all([ readTemporaryDeclaration('loader.d.ts'), readTemporaryDeclaration('types.d.ts') ]);

	const reExportMatch = loaderDeclaration.match(/export type \{([\s\S]*?)\} from ['"]\.\/types['"];?/m);
	if (!reExportMatch) { throw new Error('Unable to find loader type re-export declaration') }

	const exportedTypeNames = reExportMatch[1]
		.split(',')
		.map(name => name.trim())
		.filter(Boolean);

	const allTypeNames = Array.from(sharedTypesDeclaration.matchAll(/^export type ([A-Za-z0-9_]+)(?:<[^\n]+>)? = /gm))
		.map(([, typeName]) => typeName);

	const declarationByTypeName = new Map(allTypeNames.map(typeName => [typeName, extractTypeDeclaration(sharedTypesDeclaration, typeName)]));

	const exportedTypeNameSet = new Set(exportedTypeNames);
	const includedTypeNameSet = new Set<string>();
	const orderedTypeNames: string[] = [];

	const includeWithDependencies = (typeName: string) => {
		if (includedTypeNameSet.has(typeName)) { return }

		const declaration = declarationByTypeName.get(typeName);
		if (!declaration) { throw new Error(`Unable to find type declaration for ${typeName}`) }

		for (const dependencyName of allTypeNames) {
			if (dependencyName === typeName) { continue }

			const dependencyPattern = new RegExp(`\\b${dependencyName}\\b`);
			if (dependencyPattern.test(declaration)) { includeWithDependencies(dependencyName) }
		}

		includedTypeNameSet.add(typeName);
		orderedTypeNames.push(typeName);
	};

	for (const exportedTypeName of exportedTypeNames) {
		includeWithDependencies(exportedTypeName);
	}

	const declarationSections = orderedTypeNames.map((name) => {
		const declaration = declarationByTypeName.get(name)!;
		return exportedTypeNameSet.has(name) ? declaration : declaration.replace(/^export /, '');
	});

	return `${declarationSections.join('\n\n')}\n`;
};

const writePublicDeclaration = async (sourcePath: string, outputPath: string) => {
	const relativePath = path.relative(path.join(projectRoot, 'src'), sourcePath).replace(/\.ts$/, '.d.ts');
	const temporaryOutputPath = path.join(temporaryDeclarationDirectory, relativePath);

	await fsPromises.mkdir(path.dirname(outputPath), { recursive: true });

	if (relativePath === path.join('api', 'index.d.ts')) {
		return fsPromises.writeFile(outputPath, await buildApiIndexDeclaration());
	}

	if (relativePath === 'loader.d.ts') {
		return fsPromises.writeFile(outputPath, await buildLoaderDeclaration());
	}

	const declaration = await fsPromises.readFile(temporaryOutputPath, 'utf8');
	if (/from ['"]\.?\.?\//.test(declaration)) {
		throw new Error(`Declaration output ${relativePath} still references internal files and needs bundling support.`);
	}

	await fsPromises.writeFile(outputPath, declaration);
};

const addTypeEntry = (target: unknown) => {
	if (typeof target !== 'string') { return }

	if (!target.startsWith('./dist/') || !target.endsWith('.d.ts')) { return }

	const relativeWithoutExtension = target.slice('./dist/'.length, -'.d.ts'.length);
	const sourcePath = path.join(projectRoot, 'src', `${relativeWithoutExtension}.ts`);

	if (!fs.existsSync(sourcePath)) { throw new Error(`No source file found for declaration output ${target}`) }

	typeEntries.set(sourcePath, path.join(projectRoot, target.slice(2)));
};

const collectTypeTargets = (exportValue: unknown) => {
	if (typeof exportValue === 'string' || Array.isArray(exportValue) || !exportValue) {
		return;
	}

	if (typeof exportValue === 'object' && 'types' in exportValue) {
		addTypeEntry(exportValue.types);
	}
};

addTypeEntry(packageJson.types);

for (const exportValue of Object.values(packageJson.exports ?? {})) {
	collectTypeTargets(exportValue);
}

if (typeEntries.size === 0) {
	throw new Error('No declaration entry points could be resolved from package.json type targets.');
}

const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const run = (args: string[]) => {
	const result = spawnSync(command, args, {
		stdio: 'inherit',
		env: process.env,
	});

	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
};

await fsPromises.rm(temporaryDeclarationDirectory, { recursive: true, force: true });

try {
	run([
		'-s',
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
		...typeEntries.keys(),
	]);

	for (const [sourcePath, outputPath] of typeEntries) {
		await writePublicDeclaration(sourcePath, outputPath);
	}
} finally {
	await fsPromises.rm(temporaryDeclarationDirectory, { recursive: true, force: true });
}
