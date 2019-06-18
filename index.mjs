#!/usr/bin/env node
'use strict';

import Section from './src/Section.mjs';
import SpecReporter from './src/SpecReporter.mjs';

const section = new Section().getInterface();



export {section as default, SpecReporter};
