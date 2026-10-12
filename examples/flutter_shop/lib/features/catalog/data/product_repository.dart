import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:flutter_shop/core/network/api_client.dart';
import 'package:flutter_shop/core/network/api_config.dart';
import 'product.dart';

class ProductRepository {
  ProductRepository(this._dio);

  final Dio _dio;

  Future<List<Product>> fetchProducts({String? category, String? query}) async {
    final response = await _dio.get(
      ApiConfig.products,
      queryParameters: {
        if (category != null) 'category': category,
        if (query != null && query.isNotEmpty) 'q': query,
      },
    );
    final items = response.data['items'] as List<dynamic>;
    return items.map((e) => Product.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<Product> fetchProduct(String id) async {
    final response = await _dio.get('/products/$id');
    return Product.fromJson(response.data as Map<String, dynamic>);
  }

  Future<List<Review>> fetchReviews(String id) async {
    final response = await _dio.get('/products/$id/reviews');
    final items = response.data as List<dynamic>;
    return items.map((e) => Review.fromJson(e as Map<String, dynamic>)).toList();
  }
}

final productRepositoryProvider = Provider<ProductRepository>(
  (ref) => ProductRepository(ref.watch(dioProvider)),
);
