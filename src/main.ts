import { UserController } from './controllers/UserController';

document.addEventListener('DOMContentLoaded', async () => {
  const controller = new UserController();
  await controller.start();
});