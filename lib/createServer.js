import http from 'http';
import Docker from 'dockerode';

async function updateDockerServices(docker) {
  const servicesData = await docker.listServices();
  for (let serviceData of servicesData) {
    const service = docker.getService(serviceData.ID);
    const existingService = await service.inspect();

    const { Name: name, Spec: { TaskTemplate: { ContainerSpec: { Image: image } } } } = existingService;
    const imageWithoutTag = image.split(':')[0];
    const updatedImage = `${imageWithoutTag}:latest`;

    const updateOpts = { version: existingService.Version.Index, TaskTemplate: { ContainerSpec: { Image: updatedImage } } };
    await service.update(updateOpts);
    console.log(`Service ${name} updated!`);
  }
}

export default function createServer (docker) {
  docker = docker || new Docker();

  return http.createServer((req, res) => {
    if (req.url === '/webhook' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', async () => {
        console.log('Webhook received!', body);
        try {
          await updateDockerServices(docker);
        } catch (err) {
          console.error(`Error updating services: ${err}`);
        }
        res.end('ok');
      });
    } else {
      res.end('Invalid request');
    }
  });
}
