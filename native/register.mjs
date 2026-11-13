import { register } from './registration.mjs';
const [extensionId, binaryArgument] = process.argv.slice(2);
register({ extensionId, binaryArgument });
