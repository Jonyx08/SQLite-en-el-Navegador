import type { Account } from '../models/SessionModel';
import type { User } from '../models/UserModel';

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Required page element #${id} was not found`);
  return element as T;
}

export class UserView {
  private readonly authSection = requiredElement<HTMLElement>('authSection');
  private readonly authForm = requiredElement<HTMLFormElement>('authForm');
  private readonly authName = requiredElement<HTMLInputElement>('authName');
  private readonly authEmail = requiredElement<HTMLInputElement>('authEmail');
  private readonly authPassword = requiredElement<HTMLInputElement>('authPassword');
  private readonly authMessage = requiredElement<HTMLDivElement>('authMessage');
  private readonly authSubmit = requiredElement<HTMLButtonElement>('authSubmit');
  private readonly authToggle = requiredElement<HTMLButtonElement>('authToggle');
  private readonly appSection = requiredElement<HTMLElement>('appSection');
  private readonly accountName = requiredElement<HTMLElement>('accountName');
  private readonly userForm = requiredElement<HTMLFormElement>('userForm');
  private readonly nameInput = requiredElement<HTMLInputElement>('name');
  private readonly emailInput = requiredElement<HTMLInputElement>('email');
  private readonly tableBody = requiredElement<HTMLTableSectionElement>('userTableBody');
  private readonly message = requiredElement<HTMLDivElement>('message');
  private readonly searchInput = requiredElement<HTMLInputElement>('search');
  private readonly pagination = requiredElement<HTMLElement>('pagination');
  private readonly pageInfo = requiredElement<HTMLElement>('pageInfo');
  private readonly previousPage = requiredElement<HTMLButtonElement>('previousPage');
  private readonly nextPage = requiredElement<HTMLButtonElement>('nextPage');
  private readonly pageSizeSelect = requiredElement<HTMLSelectElement>('pageSize');
  private readonly listStatus = requiredElement<HTMLParagraphElement>('listStatus');
  private readonly exportButton = requiredElement<HTMLButtonElement>('exportCsv');
  private readonly logoutButton = requiredElement<HTMLButtonElement>('logout');
  private editingId: number | null = null;
  private authMode: 'login' | 'register' = 'login';

  setAuthMode(mode: 'login' | 'register'): void {
    this.authMode = mode;
    const registering = mode === 'register';
    this.authName.hidden = !registering;
    this.authName.required = registering;
    this.authSubmit.textContent = registering ? 'Crear cuenta' : 'Iniciar sesión';
    this.authToggle.textContent = registering ? '¿Ya tienes cuenta? Inicia sesión' : '¿No tienes cuenta? Regístrate';
    this.authMessage.textContent = '';
    this.authMessage.className = 'message';
  }

  setAccount(account: Account | null): void {
    this.authSection.hidden = account !== null;
    this.appSection.hidden = account === null;
    this.accountName.textContent = account ? `Sesión: ${account.name} (${account.email})` : '';
    if (!account) {
      this.authForm.reset();
      this.searchInput.value = '';
      this.setAuthMode('login');
    }
  }

  bindAuth(handler: (mode: 'login' | 'register', name: string, email: string, password: string) => Promise<void>): void {
    this.authToggle.addEventListener('click', () => {
      this.setAuthMode(this.authMode === 'login' ? 'register' : 'login');
    });
    this.authForm.addEventListener('submit', event => {
      event.preventDefault();
      void handler(
        this.authMode,
        this.authName.value.trim(),
        this.authEmail.value.trim(),
        this.authPassword.value
      );
    });
  }

  showAuthMessage(text: string, type: 'success' | 'error'): void {
    this.authMessage.textContent = text;
    this.authMessage.className = `message ${type}`;
  }

  getFormData(): { name: string; email: string } {
    return {
      name: this.nameInput.value.trim(),
      email: this.emailInput.value.trim()
    };
  }

  renderTable(users: User[]): void {
    this.tableBody.replaceChildren();
    if (users.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 4;
      cell.className = 'empty';
      cell.textContent = 'No hay usuarios registrados';
      row.append(cell);
      this.tableBody.append(row);
      return;
    }

    for (const user of users) {
      const row = document.createElement('tr');
      for (const value of [String(user.id), user.name, user.email]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }

      const actions = document.createElement('td');
      actions.append(
        this.createActionButton('Editar', 'edit', user.id, 'btn-edit'),
        this.createActionButton('Eliminar', 'delete', user.id, 'btn-delete')
      );
      row.append(actions);
      this.tableBody.append(row);
    }
  }

  private createActionButton(label: string, action: 'edit' | 'delete', id: number, className: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.dataset.id = String(id);
    button.dataset.action = action;
    button.textContent = action === 'edit' ? `✏️ ${label}` : `🗑️ ${label}`;
    return button;
  }

  renderPagination(page: number, totalPages: number, total: number, pageSize: number): void {
    this.pagination.hidden = total === 0;
    this.previousPage.disabled = page <= 1;
    this.nextPage.disabled = page >= totalPages;
    this.pageInfo.textContent = `Página ${page} de ${Math.max(totalPages, 1)} · ${total} resultados`;
    this.pageInfo.dataset.page = String(page);
    this.pageSizeSelect.value = String(pageSize);
  }

  setListStatus(text: string): void {
    this.listStatus.textContent = text;
    this.listStatus.hidden = !text;
  }

  showMessage(text: string, type: 'success' | 'error'): void {
    this.message.textContent = text;
    this.message.className = `message ${type}`;
    window.setTimeout(() => {
      if (this.message.textContent === text) {
        this.message.textContent = '';
        this.message.className = 'message';
      }
    }, 3500);
  }

  loadUserForEdit(user: User): void {
    this.nameInput.value = user.name;
    this.emailInput.value = user.email;
    this.editingId = user.id;
    this.userForm.querySelector<HTMLButtonElement>('button[type="submit"]')!.textContent = '💾 Actualizar';
  }

  resetForm(): void {
    this.userForm.reset();
    this.editingId = null;
    this.userForm.querySelector<HTMLButtonElement>('button[type="submit"]')!.textContent = '➕ Agregar Usuario';
  }

  bindSubmit(handler: (name: string, email: string) => Promise<void>): void {
    this.userForm.addEventListener('submit', event => {
      event.preventDefault();
      const { name, email } = this.getFormData();
      void handler(name, email);
    });
  }

  bindTableActions(onEdit: (id: number) => Promise<void>, onDelete: (id: number) => Promise<void>): void {
    this.tableBody.addEventListener('click', event => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLButtonElement>('button[data-action][data-id]');
      if (!button) return;

      const id = Number(button.dataset.id);
      if (!Number.isSafeInteger(id) || id < 1) return;
      if (button.dataset.action === 'edit') void onEdit(id);
      if (button.dataset.action === 'delete') void onDelete(id);
    });
  }

  bindSearch(handler: (query: string) => void): void {
    this.searchInput.addEventListener('input', () => handler(this.searchInput.value));
  }

  bindPageChange(handler: (page: number) => void): void {
    this.previousPage.addEventListener('click', () => handler(Math.max(1, Number(this.pageInfo.dataset.page) - 1)));
    this.nextPage.addEventListener('click', () => handler(Number(this.pageInfo.dataset.page) + 1));
  }

  bindPageSizeChange(handler: (pageSize: number) => void): void {
    this.pageSizeSelect.addEventListener('change', () => handler(Number(this.pageSizeSelect.value)));
  }

  bindExport(handler: () => Promise<void>): void {
    this.exportButton.addEventListener('click', () => void handler());
  }

  bindLogout(handler: () => Promise<void>): void {
    this.logoutButton.addEventListener('click', () => void handler());
  }

  downloadCsv(blob: Blob): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'usuarios.csv';
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  getEditingId(): number | null {
    return this.editingId;
  }
}
