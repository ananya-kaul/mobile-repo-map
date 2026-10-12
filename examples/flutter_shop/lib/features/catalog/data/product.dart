class Product {
  const Product({
    required this.id,
    required this.title,
    required this.price,
    required this.imageUrls,
    this.description = '',
    this.rating = 0,
    this.reviewCount = 0,
    this.category = 'general',
    this.inStock = true,
  });

  final String id;
  final String title;
  final double price;
  final List<String> imageUrls;
  final String description;
  final double rating;
  final int reviewCount;
  final String category;
  final bool inStock;

  String get thumbnail => imageUrls.isEmpty ? '' : imageUrls.first;

  factory Product.fromJson(Map<String, dynamic> json) {
    return Product(
      id: json['id'] as String,
      title: json['title'] as String,
      price: (json['price'] as num).toDouble(),
      imageUrls: (json['images'] as List<dynamic>? ?? const []).cast<String>(),
      description: json['description'] as String? ?? '',
      rating: (json['rating'] as num?)?.toDouble() ?? 0,
      reviewCount: json['review_count'] as int? ?? 0,
      category: json['category'] as String? ?? 'general',
      inStock: json['in_stock'] as bool? ?? true,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'price': price,
        'images': imageUrls,
        'description': description,
        'rating': rating,
        'review_count': reviewCount,
        'category': category,
        'in_stock': inStock,
      };
}

class Review {
  const Review({required this.author, required this.stars, required this.body, required this.createdAt});

  final String author;
  final int stars;
  final String body;
  final DateTime createdAt;

  factory Review.fromJson(Map<String, dynamic> json) => Review(
        author: json['author'] as String,
        stars: json['stars'] as int,
        body: json['body'] as String,
        createdAt: DateTime.parse(json['created_at'] as String),
      );
}
