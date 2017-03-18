{
    'use strict';

    const log = require('ee-log'); 
    const section = require('../');
    const SpecReporter = require('../src/SpecReporter'); 
    const assert = require('assert');





    section.use(new SpecReporter());



    section('Libraries', {timeout: 6000}, (section) => {
        section('Venue', (section) => {
            section.test('findByZip', async () => {
                //log('testing');
                assert.equal('3', 2, 'not equal, dude!');
            });

            section.test('create', async () => {
                //log('testing');
                
            });

            section.test('delete', async () => {
                //log('testing');
            });
        })


        section.test('create thisngs that are cure', async () => {
                //log('testing');
                
        });

        section.test('delete shitty stuff', async () => {
            //log('testing');
        });

        section.test('create another', async () => {
            //log('testing');
            
        });

        section.test('delete all', async () => {
            //log('testing');
        });




        section('Venue', (section) => {
            section.test('delete all', async () => {
                //log('testing');
                
            });

            section.test('delete one', async () => {
                //log('testing');
            });
        })
    });




    section.setup(() => {
        log('setting up');
    });



    section.execute();
}