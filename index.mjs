#!/usr/bin/env node
'use strict';

import Section from './src/Section';
import SpecReporter from './src/SpecReporter';

const section = new Section().getInterface();



export {section as default, SpecReporter};
