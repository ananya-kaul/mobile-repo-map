import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:flutter_shop/router/app_routes.dart';
import '../data/auth_repository.dart';

class AuthController extends AsyncNotifier<AuthUser?> {
  @override
  Future<AuthUser?> build() async => null;

  AuthRepository get _repository => ref.read(authRepositoryProvider);

  Future<void> login(String email, String password) async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(
      () => _repository.login(email: email, password: password),
    );
  }

  Future<void> logout() async {
    await _repository.logout();
    state = const AsyncData(null);

    // No BuildContext here, so go through the root navigator's router.
    final navContext = rootNavigatorKey.currentContext;
    if (navContext == null) return;
    GoRouter.of(navContext).go(AppRoute.login.path);
  }
}

final authControllerProvider =
    AsyncNotifierProvider<AuthController, AuthUser?>(AuthController.new);

final isLoggedInProvider = Provider<bool>(
  (ref) => ref.watch(authControllerProvider).valueOrNull != null,
);
