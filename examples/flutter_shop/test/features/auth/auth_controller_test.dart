import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:flutter_shop/features/auth/application/auth_controller.dart';
import 'package:flutter_shop/features/auth/data/auth_repository.dart';

class _MockAuthRepository extends Mock implements AuthRepository {}

void main() {
  late _MockAuthRepository repository;
  late ProviderContainer container;

  setUp(() {
    repository = _MockAuthRepository();
    container = ProviderContainer(
      overrides: [authRepositoryProvider.overrideWithValue(repository)],
    );
    addTearDown(container.dispose);
  });

  test('starts signed out', () async {
    expect(await container.read(authControllerProvider.future), isNull);
    expect(container.read(isLoggedInProvider), isFalse);
  });

  test('login stores the user', () async {
    when(() => repository.login(email: any(named: 'email'), password: any(named: 'password')))
        .thenAnswer((_) async => const AuthUser(id: 'u1', email: 'a@b.co', name: 'Ana'));

    await container.read(authControllerProvider.notifier).login('a@b.co', 'password1');

    expect(container.read(authControllerProvider).value?.id, 'u1');
    expect(container.read(isLoggedInProvider), isTrue);
  });

  test('login failure surfaces an error', () async {
    when(() => repository.login(email: any(named: 'email'), password: any(named: 'password')))
        .thenThrow(Exception('401'));

    await container.read(authControllerProvider.notifier).login('a@b.co', 'wrong');

    expect(container.read(authControllerProvider).hasError, isTrue);
  });
}
