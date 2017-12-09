# Section Tests - TDD for node

A beautiful, extensible and lightweight async test framework.


![](https://github.com/distributed-systems/section-tests/raw/master/doc/screenshot.png)


## Usage

**1. Install the module**

     npm i --save-dev section-tests

**2. Add test command to your package.json file**

    "scripts": {
        "test": "./node_modules/.bin/section ./test/**/*.js"
    },

You may use [glob](https://www.npmjs.com/package/glob) patterns for defining the files 
that should be loaded for executing the tests.


**3. Create your test files**

The section test framework generates structured messages from your test which then
are processed by an output reporter. That reporter needs to be instantiated before the
first test is executed.

Example:

    import section, {SpecReporter} from 'section-tests';


    // this must only be done in the first file
    // that is executed for testing
    section.use(new SpecReporter());


    // lets do some preparations before we execute
    // the actual tests
    section.setup(async () => {

        await doSetupThings();

        // print status
        section.info('Things are set up!');
    });


    // now lets execute some tests
    section('Outer Group', (section) => {
        section('Inner Group', (section) => {

            section.test('Test a', async() => {
                const result = await doSomething();
                asser(result);
            });

            section.test('Test a', async() => {
                const result = await doAnotherThing();
                asser(result);

                // print a neat log message
                section.success(`Got result ${result}`);
            });
        });
    });


The resulting output looks like this:

![](https://github.com/distributed-systems/section-tests/raw/master/doc/screenshot-2.png)