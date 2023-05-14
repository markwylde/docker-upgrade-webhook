import test from 'basictap';
import createServer from '../lib/createServer.js';

test('POST /webhook listsServices but does no updates', async t => {
  t.plan(1);

  const mockDocker = {
    listServices: () => {
      t.pass('triggered listServices');
      return [];
    },

    update: () => {
      t.fail('should not call update');
    }
  }

  const server = createServer(mockDocker);
  server.listen(8080);

  await fetch('http://localhost:8080/webhook', {
    method: 'POST',
    body: '{}'
  });

  return () => {
    server.close();
  }
});

test('POST /webhook listsServices and updates services', async t => {
  t.plan(4);

  const mockService = {
    inspect: () => ({
      Name: 'test-service',
      Spec: { TaskTemplate: { ContainerSpec: { Image: 'test-image:1.0' } } },
      Version: { Index: 1 }
    }),
    update: (opts) => {
      t.pass('triggered service update');
      t.equal(opts.version, 1, 'correct version passed to update');
      t.equal(opts.TaskTemplate.ContainerSpec.Image, 'test-image:latest', 'correct image passed to update');
    }
  };

  const mockDocker = {
    listServices: () => {
      t.pass('triggered listServices');
      return [{ ID: 'test-service' }];
    },
    getService: () => mockService
  }

  const server = createServer(mockDocker);
  server.listen(8081);

  await fetch('http://localhost:8081/webhook', {
    method: 'POST',
    body: '{}'
  });

  return () => {
    server.close();
  }
});
