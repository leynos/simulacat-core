/** @file Example entry point that starts a seeded simulation server locally. */
import {type InitialState, simulation} from '../src/index.ts';

const initialState: InitialState = {
  users: [{login: 'test', organizations: ['frontside']}],
  repositories: [{name: 'test-repo', owner: 'frontside'}],
  organizations: [{login: 'frontside'}],
  branches: [{owner: 'frontside', repo: 'test-repo', name: 'main'}],
  blobs: []
};

const app = simulation({initialState});
const {PORT} = process.env;
const port = Number(PORT) || 3300;

app.listen(port, () =>
  console.log(
    `GitHub API Simulation server started at http://localhost:${port}\nVisit http://localhost:${port}/simulation to view all available routes.`
  )
);
