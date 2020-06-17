import * as app from './app';

const port = 3000;
(<any>app).listen(port, () => console.log(`Listening at http://localhost:${port}`));
