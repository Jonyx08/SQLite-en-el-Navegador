import { SessionModel, type Account } from '../models/SessionModel';
import { ApiError, UserModel, type UserPage } from '../models/UserModel';
import { UserCache } from '../services/UserCache';
import { UserView } from '../views/UserView';

export class UserController {
  private view: UserView;
  private account: Account | null = null;
  private query = '';
  private page = 1;
  private pageSize = 10;
  private searchTimer: number | undefined;
  private refreshId = 0;

  constructor() {
    this.view = new UserView();
  }

  async start(): Promise<void> {
    this.view.bindAuth(this.handleAuth.bind(this));
    this.view.bindSubmit(this.handleSubmit.bind(this));
    this.view.bindTableActions(this.handleEdit.bind(this), this.handleDelete.bind(this));
    this.view.bindSearch(this.handleSearch.bind(this));
    this.view.bindPageChange(this.handlePageChange.bind(this));
    this.view.bindPageSizeChange(this.handlePageSizeChange.bind(this));
    this.view.bindExport(this.handleExport.bind(this));
    this.view.bindLogout(this.handleLogout.bind(this));
    this.view.setAuthMode('login');

    try {
      const session = await SessionModel.current();
      if (!session.authenticated || !session.account) {
        this.view.setAccount(null);
        return;
      }
      this.account = session.account;
      this.view.setAccount(this.account);
      await this.refresh();
    } catch (error) {
      this.view.setAccount(null);
      this.view.showAuthMessage(this.errorMessage(error), 'error');
    }
  }

  private async handleAuth(mode: 'login' | 'register', name: string, email: string, password: string): Promise<void> {
    try {
      this.account = mode === 'register'
        ? await SessionModel.register(name, email, password)
        : await SessionModel.login(email, password);
      this.view.setAccount(this.account);
      this.view.showMessage(mode === 'register' ? 'Cuenta creada correctamente' : 'Sesión iniciada', 'success');
      await this.refresh();
    } catch (error) {
      this.view.showAuthMessage(this.errorMessage(error), 'error');
    }
  }

  private async handleSubmit(name: string, email: string): Promise<void> {
    const editingId = this.view.getEditingId();
    try {
      if (editingId !== null) {
        await UserModel.update(editingId, name, email);
        this.view.showMessage('Usuario actualizado', 'success');
      } else {
        await UserModel.create(name, email);
        this.page = 1;
        this.view.showMessage('Usuario agregado', 'success');
      }
      await this.clearCachedPages();
      this.view.resetForm();
      await this.refresh();
    } catch (error) {
      this.view.showMessage(this.errorMessage(error), 'error');
    }
  }

  private async handleEdit(id: number): Promise<void> {
    try {
      const user = await UserModel.read(id);
      this.view.loadUserForEdit(user);
    } catch (error) {
      this.view.showMessage(this.errorMessage(error), 'error');
    }
  }

  private async handleDelete(id: number): Promise<void> {
    if (confirm('¿Estás seguro de eliminar este usuario?')) {
      try {
        await UserModel.delete(id);
        await this.clearCachedPages();
        this.view.showMessage('Usuario eliminado', 'success');
        await this.refresh();
      } catch (error) {
        this.view.showMessage(this.errorMessage(error), 'error');
      }
    }
  }

  private handleSearch(query: string): void {
    this.query = query.trim();
    this.page = 1;
    window.clearTimeout(this.searchTimer);
    this.searchTimer = window.setTimeout(() => {
      void this.refresh();
    }, 250);
  }

  private handlePageChange(page: number): void {
    this.page = page;
    void this.refresh();
  }

  private handlePageSizeChange(pageSize: number): void {
    this.pageSize = pageSize;
    this.page = 1;
    void this.refresh();
  }

  private async handleExport(): Promise<void> {
    try {
      const blob = await UserModel.exportCsv(this.query);
      this.view.downloadCsv(blob);
    } catch (error) {
      this.view.showMessage(this.errorMessage(error), 'error');
    }
  }

  private async handleLogout(): Promise<void> {
    if (!this.account) return;
    const accountId = this.account.id;
    try {
      await SessionModel.logout();
      try {
        await UserCache.clearAccount(accountId);
      } catch (error) {
        console.warn('Could not clear the IndexedDB cache:', error);
      }
      this.refreshId++;
      this.account = null;
      this.view.resetForm();
      this.view.setAccount(null);
      this.view.showAuthMessage('Sesión cerrada', 'success');
    } catch (error) {
      this.view.showMessage(this.errorMessage(error), 'error');
    }
  }

  private async clearCachedPages(): Promise<void> {
    if (!this.account) return;
    try {
      await UserCache.clearAccount(this.account.id);
    } catch (error) {
      console.warn('Could not clear the IndexedDB cache:', error);
    }
  }

  private async refresh(): Promise<void> {
    if (!this.account) return;
    const requestId = ++this.refreshId;
    const accountId = this.account.id;
    try {
      const result = await UserModel.readPage(this.query, this.page, this.pageSize);
      if (requestId !== this.refreshId || this.account?.id !== accountId) return;
      this.page = result.page;
      this.renderPage(result);
      try {
        await UserCache.write(accountId, this.query, this.page, this.pageSize, result);
      } catch (error) {
        console.warn('Could not update the IndexedDB cache:', error);
      }
      this.view.setListStatus('');
    } catch (error) {
      if (requestId !== this.refreshId || this.account?.id !== accountId) return;
      if (error instanceof TypeError) {
        try {
          const cached = await UserCache.read(accountId, this.query, this.page, this.pageSize);
          if (cached) {
            this.renderPage(cached);
            this.view.setListStatus('Sin conexión: se muestran los resultados guardados en este dispositivo.');
            return;
          }
        } catch (cacheError) {
          console.warn('Could not read the IndexedDB cache:', cacheError);
        }
      }
      if (error instanceof ApiError && error.status === 401) {
        this.account = null;
        this.view.setAccount(null);
      }
      this.view.showMessage(this.errorMessage(error), 'error');
    }
  }

  private renderPage(result: UserPage): void {
    this.view.renderTable(result.users);
    this.view.renderPagination(result.page, result.totalPages, result.total, result.pageSize);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Ocurrió un error inesperado';
  }
}