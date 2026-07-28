import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import jsdoc from 'eslint-plugin-jsdoc';
import tsEslint from 'typescript-eslint';
import tsParser from '@typescript-eslint/parser';
import typeScriptEslint from '@typescript-eslint/eslint-plugin';

export default defineConfig(
	{
		ignores: [
			'node_modules/**',
			'dist/**',
			'benchmarks/**',
			'tests/**',
			'*.config.[tj]s',
			'src/@types/**'
		]
	},
	{
		extends: [
			eslint.configs.recommended,
			...tsEslint.configs.recommended
		],
		linterOptions: {
			reportUnusedDisableDirectives: 'off'
		},
		// @ts-expect-error plugin needs update for flat typing interop
		plugins: { typeScriptEslint, jsdoc },
		languageOptions: {
			parserOptions: {
				parser: tsParser,
				parserOptions: {
					ecmaFeatures: { impliedStrict: true }
				}
			}
		},
		settings: {
			jsdoc: {
				mode: 'typescript',
				structuredTags: {
					template: { name: 'namepath-defining', type: true }
				}
			}
		},
		rules: {
			'jsdoc/require-jsdoc': 'off',
			'jsdoc/require-param': 'off',
			'jsdoc/require-returns': 'off',
			'jsdoc/check-param-names': 'off',
			'jsdoc/tag-lines': 'off',
			'jsdoc/no-defaults': 'off',
			indent: 'off',
			'linebreak-style': ['error', 'unix'],
			quotes: 'off',
			semi: 'off',
			'prefer-rest-params': 'off',
			'no-empty': 'off',
			'@typescript-eslint/unbound-method': 'off',
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/ban-ts-comment': 'off',
			'@typescript-eslint/no-unused-expressions': 'off',
			'@typescript-eslint/restrict-template-expressions': 'off',
			'@typescript-eslint/no-unsafe-enum-comparison': 'off',
			'@typescript-eslint/method-signature-style': 'off',
			'@typescript-eslint/no-unused-vars': ['error', {
				args: 'all',
				argsIgnorePattern: '^_',
				caughtErrors: 'all',
				caughtErrorsIgnorePattern: '^_',
				destructuredArrayIgnorePattern: '^_',
				varsIgnorePattern: '^_',
				ignoreRestSiblings: true
			}]
		}
	},
	{
		files: ['scripts/**/*.js'],
		rules: {
			'jsdoc/no-types': 'off'
		}
	}
);