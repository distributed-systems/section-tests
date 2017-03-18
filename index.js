#!/usr/bin/env node
{
    'use strict';

    const Section = require('./src/Section');


    // expose the section interface
    module.exports = new Section().getInterface();
}