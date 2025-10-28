# TypeScript Migration Guide

## Overview

The `section-tests` project has been completely rewritten in TypeScript. This document outlines the changes and provides guidance for development and usage.

## What Changed

### Source Files
- All `.js` files have been converted to `.ts`
- Added comprehensive type definitions in `src/types.ts`
- Added type declarations for external dependencies in `src/declarations.d.ts`
- Created type definitions for the local chalk library in `src/lib/chalk.d.ts`

### Build System
- TypeScript compilation outputs to `dist/` directory
- Source maps and declaration files are generated
- Main entry point changed from `index.js` to `dist/index.js`
- Bin scripts now point to compiled versions in `dist/bin/`

### Package Structure
```
section-tests/
├── src/                    # TypeScript source files
│   ├── message/           # Message classes
│   ├── lib/               # Third-party libraries (chalk)
│   ├── Section.ts         # Core section implementation
│   ├── SectionExecutor.ts # Test execution logic
│   ├── TestRunner.ts      # Test runner
│   ├── SpecReporter.ts    # Console reporter
│   ├── types.ts           # Type definitions
│   └── declarations.d.ts  # External module declarations
├── bin/                    # TypeScript bin scripts
│   ├── run.ts             # Development runner
│   └── run-npm.ts         # NPM package runner
├── test/                   # TypeScript test files
│   └── main.ts            # Test suite
├── dist/                   # Compiled JavaScript (generated)
├── index.ts               # Main entry point
├── package.json
└── tsconfig.json          # TypeScript configuration
```

## Development Workflow

### Building the Project
```bash
npm run build
```

This compiles all TypeScript files to the `dist/` directory with source maps and type declarations.

### Running Tests
```bash
npm test
```

This builds the project and runs the test suite.

### Watch Mode
```bash
npm run test:watch
```

This runs TypeScript in watch mode for continuous compilation during development.

## Using TypeScript with section-tests

### Type-Safe Test Writing

The package now exports TypeScript types for better IDE support:

```typescript
import section, { SpecReporter } from 'section-tests';
import assert from 'assert';

// Set up the reporter
section.use(new SpecReporter());

// Write type-safe tests
section('My Test Suite', (section) => {
    section.test('should do something', async () => {
        assert.equal(1 + 1, 2);
    });
    
    section.setup('Setting up', async () => {
        // Setup code with full type checking
    });
    
    section.destroy('Cleaning up', async () => {
        // Cleanup code
    });
});
```

### Available Types

- `SectionInterface` - The main section interface
- `TestFunction` - Type for test definitions
- `SetupFunction` - Type for setup definitions
- `DestroyFunction` - Type for destroy definitions
- `Transport` - Interface for custom reporters
- `ExecutionResult` - Test execution results
- And many more in `src/types.ts`

## Migration for Users

If you're using section-tests as a dependency:

1. Update to the latest version
2. No code changes required - the API remains the same
3. You now get TypeScript definitions automatically
4. Your editor will provide better autocomplete and type checking

## Contributing

When contributing to the project:

1. Write TypeScript code in the `src/` directory
2. Run `npm run build` to compile
3. Run `npm test` to verify your changes
4. Ensure all tests pass before submitting a PR

## Type Safety Benefits

- Compile-time error detection
- Better IDE support with autocomplete
- Self-documenting code through types
- Easier refactoring
- Reduced runtime errors

## Backward Compatibility

The public API remains unchanged. All existing JavaScript code using section-tests will continue to work without modifications.

