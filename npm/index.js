#!/usr/bin/env node
import Section from './src/Section.js';
import SpecReporter from './src/SpecReporter.js';

const section = new Section().getInterface();


export {
    section as default, 
    SpecReporter,
};
