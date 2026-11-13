import { register } from './registration.mjs';
const [extensionId] = process.argv.slice(2);
register({ extensionId, remove: true });
