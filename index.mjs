#!/usr/bin/env node
import Section from './src/Section';
import SpecReporter from './src/SpecReporter';

const section = new Section().getInterface();


export {
    section as default, 
    SpecReporter,
};
