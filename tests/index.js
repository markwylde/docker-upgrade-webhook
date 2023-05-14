import test from 'basictap';
import createServer from '../lib/createServer.js';

test('POST /webhook listsServices but does no updates', async t => {
  t.plan(1);

  const mockDocker = {
    listServices: () => {
      t.pass('triggered listServices');
      return [];
    },
    pull: () => Promise.resolve(),
    getService: () => {
      return {
        inspect: () => Promise.resolve(),
        update: () => {
          t.fail('should not call update');
        }
      };
    }
  }

  const server = createServer(mockDocker, 100);
  server.listen(8080);

  await fetch('http://localhost:8080/webhook', {
    method: 'POST',
    body: '{}'
  });

  server.close();
});

test('POST /webhook listsServices and updates services', async t => {
  t.plan(3);

  const mockService = {
    inspect: () => Promise.resolve({
      ID: 'test-service',
      Spec: { Name: 'test-service', TaskTemplate: { ContainerSpec: { Image: 'test-image@1.0' } } },
      Version: { Index: 1 }
    }),
    update: (opts) => {
      t.pass('triggered service update');
      t.equal(opts.version, 1, 'correct version passed to update');
    }
  };

  const mockDocker = {
    pull: () => Promise.resolve(),
    listServices: () => {
      t.pass('triggered listServices');
      return [{ ID: 'test-service' }];
    },
    getService: () => mockService,
    getImage: () => ({
      inspect: () => Promise.resolve({
        RepoDigests: ['test-image@2.0']
      })
    })
  }

  const server = createServer(mockDocker, 100);
  server.listen(8081);

  await fetch('http://localhost:8081/webhook', {
    method: 'POST',
    body: '{}'
  });

  server.close();
});
