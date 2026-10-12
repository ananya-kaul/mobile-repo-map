import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:flutter_shop/core/utils/formatters.dart';
import 'package:flutter_shop/features/auth/application/auth_controller.dart';
import 'package:flutter_shop/router/app_routes.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authControllerProvider).valueOrNull;
    return Scaffold(
      appBar: AppBar(title: const Text('Account')),
      body: ListView(
        children: [
          ListTile(
            leading: const CircleAvatar(child: Icon(Icons.person)),
            title: Text(user?.name ?? 'Guest'),
            subtitle: Text(user == null ? 'Not signed in' : Formatters.maskEmail(user.email)),
          ),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.receipt_long_outlined),
            title: const Text('Orders'),
            onTap: () => context.push(AppRoute.orders.path),
          ),
          ListTile(
            leading: const Icon(Icons.settings_outlined),
            title: const Text('Settings'),
            onTap: () => context.push(AppRoute.settings.path),
          ),
          if (user != null)
            ListTile(
              leading: const Icon(Icons.logout),
              title: const Text('Sign out'),
              onTap: () => ref.read(authControllerProvider.notifier).logout(),
            )
          else
            ListTile(
              leading: const Icon(Icons.login),
              title: const Text('Sign in'),
              onTap: () => context.go(AppRoute.login.path),
            ),
        ],
      ),
    );
  }
}
