/**
 * Is this a development build?
 *
 * The one place in the app that reads `import.meta.env` for this purpose, and
 * the optional chain is load-bearing rather than defensive style:
 * `import.meta.env` is a Vite construct that does NOT exist under
 * `tsx --test`, the web test runner. Written `import.meta.env.DEV`, every test
 * that imports a module guarded by this constant dies on
 * `TypeError: Cannot read properties of undefined (reading 'DEV')`.
 *
 * The useful consequence: under the test runner this reads false, so the test
 * environment behaves exactly like a production build and the guards can be
 * asserted with no mocking at all.
 *
 * Used to keep destructive "(dev)" controls out of the production HR UI
 * (T1-5). It is a UX and defence-in-depth measure, NOT a security boundary --
 * `dev_tools._require_system_manager_for_clear()` is, and it stays.
 */
export const IS_DEV_BUILD = Boolean(import.meta.env?.DEV);
