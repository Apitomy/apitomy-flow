import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ui = fileURLToPath(new URL('../', import.meta.url));
const consumer = fileURLToPath(new URL('./consumer/', import.meta.url));
const artifacts = fileURLToPath(new URL('./consumer/artifacts/', import.meta.url));
const npm = (args, cwd) => execFileSync('npm', args, { cwd, stdio: 'inherit' });

npm(['run', 'build'], ui);
mkdirSync(artifacts, { recursive: true });
for (const name of readdirSync(artifacts)) rmSync(`${artifacts}/${name}`);
npm(['pack', '--pack-destination', artifacts], ui);
const tarballs = readdirSync(artifacts).filter(name => name.endsWith('.tgz'));
if (tarballs.length !== 1) throw new Error('Expected exactly one packed library');
npm(['ci'], consumer);
npm(['install', '--no-save', '--package-lock=false', `${artifacts}/${tarballs[0]}`], consumer);
npm(['ls', '--all', '@apitomy/flow-ui', 'react', 'react-dom', '@xyflow/react',
    '@patternfly/patternfly', '@patternfly/react-core', '@patternfly/react-icons'], consumer);
npm(['run', 'build'], consumer);
