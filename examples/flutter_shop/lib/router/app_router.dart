import 'package:go_router/go_router.dart';

import 'package:flutter_shop/core/widgets/app_scaffold.dart';
import 'package:flutter_shop/features/auth/presentation/login_screen.dart';
import 'package:flutter_shop/features/auth/presentation/splash_screen.dart';
import 'package:flutter_shop/features/cart/presentation/cart_screen.dart';
import 'package:flutter_shop/features/catalog/presentation/home_screen.dart';
import 'package:flutter_shop/features/catalog/presentation/product_detail_screen.dart';
import 'package:flutter_shop/features/catalog/presentation/product_reviews_screen.dart';
import 'package:flutter_shop/features/checkout/presentation/checkout_screen.dart';
import 'package:flutter_shop/features/orders/presentation/orders_screen.dart';
import 'package:flutter_shop/features/profile/presentation/profile_screen.dart';
import 'package:flutter_shop/features/profile/presentation/settings_screen.dart';
import 'app_routes.dart';

final appRouter = GoRouter(
  navigatorKey: rootNavigatorKey,
  initialLocation: AppRoute.splash.path,
  debugLogDiagnostics: true,
  routes: [
    GoRoute(
      path: AppRoute.splash.path,
      name: 'splash',
      builder: (context, state) => const SplashScreen(),
    ),
    GoRoute(
      path: AppRoute.login.path,
      name: 'login',
      builder: (context, state) => const LoginScreen(),
    ),
    GoRoute(
      path: AppRoute.home.path,
      name: 'home',
      builder: (context, state) => const HomeScreen(),
    ),
    GoRoute(
      path: AppRoute.product.path,
      name: 'product',
      builder: (context, state) => ProductDetailScreen(
        productId: state.pathParameters['id']!,
      ),
      routes: [
        GoRoute(
          path: 'reviews',
          name: 'reviews',
          builder: (context, state) => ProductReviewsScreen(
            productId: state.pathParameters['id']!,
          ),
        ),
      ],
    ),
    GoRoute(
      path: AppRoute.cart.path,
      name: 'cart',
      builder: (context, state) => const CartScreen(),
    ),
    GoRoute(
      path: AppRoute.checkout.path,
      name: 'checkout',
      builder: (context, state) => const CheckoutScreen(),
    ),
    GoRoute(
      path: AppRoute.orders.path,
      name: 'orders',
      builder: (context, state) => const AppScaffold(
        title: 'My orders',
        child: OrdersScreen(),
      ),
    ),
    GoRoute(
      path: AppRoute.profile.path,
      name: 'profile',
      builder: (context, state) => const ProfileScreen(),
    ),
    GoRoute(
      path: AppRoute.settings.path,
      name: 'settings',
      builder: (context, state) => const SettingsScreen(),
    ),
  ],
);
