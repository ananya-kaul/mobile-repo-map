import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'package:flutter_shop/router/app_routes.dart';

/// Common chrome (app bar + cart shortcut) for secondary pages.
class AppScaffold extends StatelessWidget {
  const AppScaffold({super.key, required this.title, required this.child});

  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(title),
        actions: [
          IconButton(
            icon: const Icon(Icons.shopping_bag_outlined),
            onPressed: () => context.push(AppRoute.cart.path),
          ),
        ],
      ),
      body: SafeArea(child: child),
    );
  }
}
